import { revalidatePath } from "next/cache";
import { formatZodError } from "@/lib/zod-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { importLibrariesFromHub, removeLibraryImportFromHub } from "@/lib/library-hub";

const ImportPostSchema = z.object({
  libraryIds: z.array(z.string().trim().min(1).max(64)).min(1).max(50),
});

const ImportDeleteSchema = z.object({
  libraryId: z.string().trim().min(1).max(64),
});

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = ImportPostSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const { libraryIds } = parsed.data;

  const result = await importLibrariesFromHub({
    userId: session.user.id,
    libraryIds,
  });

  revalidatePath("/builders");
  revalidatePath("/dashboard");
  return NextResponse.json({ ...result, libraryIds });
}

export async function DELETE(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = ImportDeleteSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }
  const { libraryId } = parsed.data;

  const result = await removeLibraryImportFromHub({
    userId: session.user.id,
    libraryId,
  });

  revalidatePath("/builders");
  revalidatePath("/dashboard");
  revalidatePath("/library-hub");
  return NextResponse.json({ ...result, libraryId });
}
