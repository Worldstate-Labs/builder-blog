import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { formatZodError } from "@/lib/zod-error";
import {
  getAllSourceConfigs,
  getUserSourceConfigs,
  resetUserSourceConfigs,
  updateUserSourceConfigAndDefault,
  updateUserSourceConfig,
  type SourceConfigPatch,
} from "@/lib/source-config-store";
import { SEEDED_SOURCE_IDS } from "@/lib/source-config-seed";

// Per-user endpoint (any logged-in user, no admin gate). GET lists the user's
// own (materialized-from-default) source configs; PATCH updates one; DELETE
// resets all of the user's source configs back to the system default. When the
// current user is an admin, PATCH also updates the system default template so
// new users copy the admin's latest saved defaults.

const ContentQualitySchema = z
  .object({
    minChars: z.number().int().min(0),
    minContentUnits: z.number().int().min(0),
    minLocalDiversity: z.number().min(0).max(1).optional(),
    maxTimestampDensity: z.number().min(0).max(1).optional(),
  })
  .strict();

const SourceTypePatchSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    agentDefaultStatus: z.enum(["ready", "requires_agent"]).optional(),
    defaultFetchDays: z.number().int().positive().max(90).optional(),
    defaultFetchLimit: z.number().int().positive().max(1000).optional(),
    contentQuality: ContentQualitySchema.optional(),
    summaryPromptBody: z.string().min(1).max(20_000).optional(),
    fetchPromptBody: z.string().max(20_000).nullable().optional(),
    summaryStyle: z.enum(["x_twitter", "podcast_or_video", "blog_or_document"]).optional(),
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
  const configs = await getSettingsSourceConfigs(session.user.id);
  return NextResponse.json({ configs });
}

async function getSettingsSourceConfigs(userId: string) {
  const [userConfigs, defaultConfigs] = await Promise.all([
    getUserSourceConfigs(userId),
    getAllSourceConfigs(),
  ]);
  const defaultBySourceId = new Map(defaultConfigs.map((c) => [c.sourceId, c]));
  return userConfigs.map((config) => ({
    ...config,
    contentQuality: defaultBySourceId.get(config.sourceId)?.contentQuality ?? config.contentQuality,
  }));
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
    return NextResponse.json({ error: "Unknown source type." }, { status: 400 });
  }
  const isAdmin = isAdminEmail(session.user.email);
  if (!isAdmin && patch.contentQuality !== undefined) {
    return NextResponse.json(
      { error: "Quality gates can only be changed by an admin." },
      { status: 403 },
    );
  }
  try {
    const update = isAdmin
      ? updateUserSourceConfigAndDefault
      : updateUserSourceConfig;
    const config = await update(
      session.user.id,
      sourceId,
      patch as SourceConfigPatch,
      session.user.email ?? null,
    );
    return NextResponse.json({ config });
  } catch {
    return NextResponse.json(
      { error: "Could not save source type settings." },
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
  const configs = await getSettingsSourceConfigs(session.user.id);
  return NextResponse.json({ configs });
}
