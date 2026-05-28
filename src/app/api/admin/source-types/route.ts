import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { formatZodError } from "@/lib/zod-error";
import {
  getAllSourceConfigs,
  updateSourceConfig,
  type SourceConfigPatch,
} from "@/lib/source-config-store";
import { SEEDED_SOURCE_IDS } from "@/lib/source-config-seed";

// Admin-only endpoint. GET lists every SourceTypeConfig row; PATCH
// applies a partial update to one row keyed by sourceId. The route is
// the only entry point that should mutate this table — everything else
// reads through `source-config-store`.

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
  if (!session?.user?.id || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const configs = await getAllSourceConfigs();
  return NextResponse.json({ configs });
}

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id || !isAdminEmail(session.user.email)) {
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
    const config = await updateSourceConfig(sourceId, patch as SourceConfigPatch, session.user.email ?? null);
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 },
    );
  }
}
