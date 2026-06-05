import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { removeDigestPipelineImportFromHub } from "@/lib/library-hub";

type Params = { params: Promise<{ pipelineId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { pipelineId } = await params;
  const result = await removeDigestPipelineImportFromHub({
    userId: session.user.id,
    pipelineId,
  });

  revalidatePath("/builders");
  revalidatePath("/dashboard");
  revalidatePath("/library-hub");
  return NextResponse.json({ ...result, pipelineId });
}
