import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { formatZodError } from "@/lib/zod-error";
import {
  getUserSourceConfigs,
  resetUserSourceConfigs,
  updateUserSourceConfig,
  type SourceConfigPatch,
} from "@/lib/source-config-store";
import { SEEDED_SOURCE_IDS } from "@/lib/source-config-seed";

// Per-user endpoint (any logged-in user, no admin gate). GET lists the user's
// own (materialized-from-default) source configs; PATCH updates one; DELETE
// resets all of the user's source configs back to the system default.

const ContentQualitySchema = z
  .object({
    primaryContentOnly: z.boolean(),
    minChars: z.number().int().min(0),
    minWords: z.number().int().min(0),
    minUniqueWordRatio: z.number().min(0).max(1).optional(),
    maxTimestampWordRatio: z.number().min(0).max(1).optional(),
    disallowedPrimarySources: z.array(z.string()),
  })
  .strict();

const SourceTypePatchSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    agentDefaultStatus: z.enum(["ready", "requires_agent"]).optional(),
    defaultFetchDays: z.number().int().positive().max(365).optional(),
    defaultFetchLimit: z.number().int().positive().max(1000).optional(),
    contentQuality: ContentQualitySchema.optional(),
    summaryPromptBody: z.string().min(1).max(20_000).optional(),
    fetchPromptBody: z.string().max(20_000).nullable().optional(),
    summaryStyle: z.enum(["x_twitter", "podcast_or_video", "blog_or_document"]).optional(),
    summaryLanguage: z.string().trim().min(2).max(16).optional(),
    summaryLengthHint: z.string().max(240).nullable().optional(),
  })
  .strict();

const PatchBodySchema = z.object({
  sourceId: z.string().trim().min(1),
  patch: SourceTypePatchSchema,
});

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const configs = await getUserSourceConfigs(session.user.id);
  return NextResponse.json({ configs });
}

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = PatchBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const { sourceId, patch } = parsed.data;
  if (!SEEDED_SOURCE_IDS.includes(sourceId)) {
    return NextResponse.json({ error: `Unknown sourceId: ${sourceId}` }, { status: 400 });
  }
  try {
    const config = await updateUserSourceConfig(
      session.user.id,
      sourceId,
      patch as SourceConfigPatch,
      session.user.email ?? null,
    );
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 },
    );
  }
}

// Reset all of the user's source configs to the system default (drops their
// rows; the next read re-copies the default template).
export async function DELETE() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await resetUserSourceConfigs(session.user.id);
  const configs = await getUserSourceConfigs(session.user.id);
  return NextResponse.json({ configs });
}
