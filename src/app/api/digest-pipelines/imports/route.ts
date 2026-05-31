import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { importDigestPipelineFromHub } from "@/lib/library-hub";
import { formatZodError } from "@/lib/zod-error";

const ImportSchema = z.object({
  pipelineId: z.string().trim().min(1).max(64),
});

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = ImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const result = await importDigestPipelineFromHub({
    userId: session.user.id,
    pipelineId: parsed.data.pipelineId,
  });

  revalidatePath("/dashboard");
  revalidatePath("/library-hub");
  return NextResponse.json({ ...result, pipelineId: parsed.data.pipelineId });
}
