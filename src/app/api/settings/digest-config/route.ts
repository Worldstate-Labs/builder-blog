import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { formatZodError } from "@/lib/zod-error";
import {
  getUserDigestConfig,
  resetUserDigestConfig,
  updateUserDigestConfigAndDefault,
  updateUserDigestConfig,
  type DigestConfigPatch,
} from "@/lib/source-config-store";
import { SEEDED_SOURCE_IDS } from "@/lib/source-config-seed";

// Per-user endpoint (any logged-in user) for the user's DigestConfig copy.
// Admin PATCH also updates the system default template; existing users keep
// their own copies, while new users materialize from that default.

const DigestPatchSchema = z
  .object({
    digestIntro: z.string().min(1).max(20_000).optional(),
    translate: z.string().min(1).max(20_000).optional(),
    commonSummaryRules: z.string().min(1).max(20_000).optional(),
    digestOrder: z
      .array(z.string().min(1))
      .min(1)
      .max(32)
      .refine(
        (arr) => arr.every((id) => SEEDED_SOURCE_IDS.includes(id)),
        { message: `digestOrder must only contain known source IDs (${SEEDED_SOURCE_IDS.join(", ")})` },
      )
      .optional(),
  })
  .strict();

const PatchBodySchema = z.object({ patch: DigestPatchSchema });

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await getUserDigestConfig(session.user.id);
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
  try {
    const update = isAdminEmail(session.user.email)
      ? updateUserDigestConfigAndDefault
      : updateUserDigestConfig;
    const config = await update(
      session.user.id,
      parsed.data.patch as DigestConfigPatch,
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
