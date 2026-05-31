import { formatZodError } from "@/lib/zod-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Digest publishedAt lookback floor (days). Dedicated endpoint (mirrors the
// summary-language route) so the digest prompt dialog can set just the max-age
// without touching the user's summary-language preference. Null clears the
// floor (no limit — every not-yet-digested post is a candidate).
const DigestMaxAgeSchema = z.object({
  digestMaxPostAgeDays: z.number().int().min(1).max(365).nullable(),
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
  const digestMaxPostAgeDays = parsed.data.digestMaxPostAgeDays;

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
