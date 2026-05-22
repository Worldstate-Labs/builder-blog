import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserFromBearer } from "@/lib/tokens";

const DigestSchema = z.object({
  title: z.string().min(1).max(180),
  content: z.string().min(1),
  language: z.string().default("zh"),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  itemCount: z.number().int().min(0).default(0),
});

export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = DigestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const now = new Date();
  const digest = await prisma.digest.create({
    data: {
      userId: user.id,
      title: parsed.data.title,
      content: parsed.data.content,
      language: parsed.data.language,
      periodStart: parsed.data.periodStart
        ? new Date(parsed.data.periodStart)
        : new Date(now.getTime() - 24 * 60 * 60 * 1000),
      periodEnd: parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : now,
      itemCount: parsed.data.itemCount,
      source: "skill",
      status: "SYNCED",
    },
  });

  return NextResponse.json({ status: "ok", digest });
}
