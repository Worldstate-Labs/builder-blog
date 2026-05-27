import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { formatZodError } from "@/lib/zod-error";
import {
  getDigestConfig,
  updateDigestConfig,
  type DigestConfigPatch,
} from "@/lib/source-config-store";
import { SEEDED_SOURCE_IDS } from "@/lib/source-config-seed";

// Admin-only endpoint for the singleton DigestConfig row.

const DigestPatchSchema = z
  .object({
    digestTopPrompt: z.string().min(1).max(20_000).optional(),
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
  if (!session?.user?.id || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = await getDigestConfig();
  return NextResponse.json({ config });
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
  try {
    const config = await updateDigestConfig(parsed.data.patch as DigestConfigPatch, session.user.email ?? null);
    return NextResponse.json({ config });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 },
    );
  }
}
