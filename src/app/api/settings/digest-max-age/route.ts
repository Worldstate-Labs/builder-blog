import { formatZodError } from "@/lib/zod-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { DEFAULT_DIGEST_MAX_POST_AGE_DAYS, MAX_DIGEST_MAX_POST_AGE_DAYS } from "@/lib/feed-preferences";
import { prisma } from "@/lib/prisma";

// Digest publishedAt lookback floor (days). Dedicated endpoint (mirrors the
// summary-language route) so the digest prompt dialog can set just the max-age
// without touching the user's summary-language preference. Null is accepted
// for older clients and resolves to the default 30-day window.
const DigestMaxAgeSchema = z.object({
  digestMaxPostAgeDays: z.number().int().min(1).max(MAX_DIGEST_MAX_POST_AGE_DAYS).nullable(),
});

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = DigestMaxAgeSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const digestMaxPostAgeDays = parsed.data.digestMaxPostAgeDays ?? DEFAULT_DIGEST_MAX_POST_AGE_DAYS;

  const preference = await prisma.userFeedPreference.upsert({
    where: { userId: session.user.id },
    update: { digestMaxPostAgeDays },
    create: { userId: session.user.id, digestMaxPostAgeDays },
  });

  return NextResponse.json({
    status: "ok",
    digestMaxPostAgeDays: preference.digestMaxPostAgeDays,
  });
}
