import { formatZodError } from "@/lib/zod-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Account-wide summary output language. Dedicated endpoint (not the broader
// feed-preferences PATCH) so the cron dialog can set just the language without
// resetting the user's digest-frequency/max-age preferences. Empty string
// clears the override (falls back to the per-source default).
const SummaryLanguageSchema = z.object({
  summaryLanguage: z.string().max(40),
});

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = SummaryLanguageSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const summaryLanguage = parsed.data.summaryLanguage.trim() || null;

  const preference = await prisma.userFeedPreference.upsert({
    where: { userId: session.user.id },
    update: { summaryLanguage },
    create: { userId: session.user.id, summaryLanguage },
  });

  return NextResponse.json({ status: "ok", summaryLanguage: preference.summaryLanguage });
}
