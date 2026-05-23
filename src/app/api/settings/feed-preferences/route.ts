import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import {
  defaultDigestMaxPostAgeDays,
  digestMaxPostAgeDays,
  normalizeDigestFrequency,
} from "@/lib/feed-preferences";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const customDaysInput = Number(payload?.digestCustomFrequencyDays);
  const maxPostAgeInput = Number(payload?.digestMaxPostAgeDays);
  const digestCustomFrequencyDays =
    Number.isFinite(customDaysInput) && customDaysInput > 0
      ? Math.min(365, Math.floor(customDaysInput))
      : null;
  const recommendationProfile = String(payload?.recommendationProfile ?? "")
    .trim()
    .slice(0, 4000);

  const preference = await prisma.userFeedPreference.upsert({
    where: { userId: session.user.id },
    update: {
      digestFrequency: normalizeDigestFrequency(String(payload?.digestFrequency ?? "")),
      digestCustomFrequencyDays,
      digestMaxPostAgeDays: digestMaxPostAgeDays({
        digestMaxPostAgeDays: Number.isFinite(maxPostAgeInput)
          ? maxPostAgeInput
          : defaultDigestMaxPostAgeDays,
      }),
      recommendationProfile: recommendationProfile || null,
    },
    create: {
      userId: session.user.id,
      digestFrequency: normalizeDigestFrequency(String(payload?.digestFrequency ?? "")),
      digestCustomFrequencyDays,
      digestMaxPostAgeDays: digestMaxPostAgeDays({
        digestMaxPostAgeDays: Number.isFinite(maxPostAgeInput)
          ? maxPostAgeInput
          : defaultDigestMaxPostAgeDays,
      }),
      recommendationProfile: recommendationProfile || null,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/recommendations");
  return NextResponse.json({ status: "ok", preference });
}
