import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import {
  shareDigestPipelineToHub,
  unshareDigestPipelineFromHub,
  updateDigestPipelineTitle,
} from "@/lib/library-hub";
import { formatZodError } from "@/lib/zod-error";

const ShareSchema = z.object({
  title: z.string().trim().max(120).optional(),
  description: z.string().trim().max(280).optional(),
});

const TitleSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = ShareSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const pipeline = await shareDigestPipelineToHub({
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    title: parsed.data.title,
    description: parsed.data.description,
  });

  revalidatePath("/library-hub");
  revalidatePath("/dashboard");
  return NextResponse.json({ pipeline });
}

export async function DELETE() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await unshareDigestPipelineFromHub(session.user.id);

  revalidatePath("/library-hub");
  revalidatePath("/dashboard");
  return NextResponse.json(result);
}

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = TitleSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const pipeline = await updateDigestPipelineTitle({
    userId: session.user.id,
    title: parsed.data.title,
  });

  revalidatePath("/library-hub");
  revalidatePath("/dashboard");
  return NextResponse.json({ pipeline });
}
