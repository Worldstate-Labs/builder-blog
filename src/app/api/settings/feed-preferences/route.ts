import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import {
  defaultDigestMaxPostAgeDays,
  digestMaxPostAgeDays,
  normalizeDigestFrequency,
} from "@/lib/feed-preferences";
import { prisma } from "@/lib/prisma";

const FeedPreferencesSchema = z.object({
  digestFrequency: z.string().max(32).optional(),
  digestCustomFrequencyDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .nullable()
    .optional(),
  digestMaxPostAgeDays: z.number().int().min(1).max(365).optional(),
  recommendationProfile: z.string().max(4000).optional(),
});

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = FeedPreferencesSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const digestFrequency = normalizeDigestFrequency(parsed.data.digestFrequency ?? "");
  const digestCustomFrequencyDays = parsed.data.digestCustomFrequencyDays ?? null;
  const maxPostAge = digestMaxPostAgeDays({
    digestMaxPostAgeDays:
      parsed.data.digestMaxPostAgeDays ?? defaultDigestMaxPostAgeDays,
  });
  const recommendationProfile = parsed.data.recommendationProfile?.trim() ?? "";

  const preference = await prisma.userFeedPreference.upsert({
    where: { userId: session.user.id },
    update: {
      digestFrequency,
      digestCustomFrequencyDays,
      digestMaxPostAgeDays: maxPostAge,
      recommendationProfile: recommendationProfile || null,
    },
    create: {
      userId: session.user.id,
      digestFrequency,
      digestCustomFrequencyDays,
      digestMaxPostAgeDays: maxPostAge,
      recommendationProfile: recommendationProfile || null,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/recommendations");
  return NextResponse.json({ status: "ok", preference });
}
