import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { formatZodError } from "@/lib/zod-error";
import {
  getDigestConfig,
  getUserDigestConfig,
  resetUserDigestConfig,
  updateUserDigestConfigAndDefault,
  updateUserDigestConfig,
  type DigestConfigPatch,
} from "@/lib/source-config-store";

// Per-user endpoint (any logged-in user) for the user's DigestConfig copy.
// Admin PATCH also updates the system default template; existing users keep
// their own copies, while new users materialize from that default.

const DigestPatchSchema = z
  .object({
    headlinePrompt: z.string().min(1).max(20_000).optional(),
    perSourceSummaryPrompt: z.string().max(20_000).optional(),
    commonFetchRules: z.string().min(1).max(20_000).optional(),
    commonSummaryRules: z.string().min(1).max(20_000).optional(),
  })
  .strict();

const PatchBodySchema = z.object({ patch: DigestPatchSchema });

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [userConfig, defaultConfig] = await Promise.all([
    getUserDigestConfig(session.user.id),
    getDigestConfig(),
  ]);
  const config = isAdminEmail(session.user.email)
    ? userConfig
    : {
        ...userConfig,
        commonFetchRules: defaultConfig.commonFetchRules,
        commonSummaryRules: defaultConfig.commonSummaryRules,
      };
  return NextResponse.json({ config });
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
  const isAdmin = isAdminEmail(session.user.email);
  const writesAdminOnlyRules =
    parsed.data.patch.commonFetchRules !== undefined ||
    parsed.data.patch.commonSummaryRules !== undefined;
  const writesAdminOnlyDigestPrompts =
    parsed.data.patch.headlinePrompt !== undefined ||
    parsed.data.patch.perSourceSummaryPrompt !== undefined;
  if (!isAdmin && writesAdminOnlyRules) {
    return NextResponse.json(
      { error: "Common fetch and post-summary rules can only be changed by an admin." },
      { status: 403 },
    );
  }
  if (!isAdmin && writesAdminOnlyDigestPrompts) {
    return NextResponse.json(
      { error: "Headline and per-source digest prompts can only be changed by an admin." },
      { status: 403 },
    );
  }
  try {
    const update = isAdmin
      ? updateUserDigestConfigAndDefault
      : updateUserDigestConfig;
    const config = await update(
      session.user.id,
      parsed.data.patch as DigestConfigPatch,
      session.user.email ?? null,
    );
    return NextResponse.json({ config });
  } catch {
    return NextResponse.json(
      { error: "Could not save AI Digest rules." },
      { status: 500 },
    );
  }
}

// Reset the user's digest config to the system default.
export async function DELETE() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await resetUserDigestConfig(session.user.id);
  const config = await getUserDigestConfig(session.user.id);
  return NextResponse.json({ config });
}
