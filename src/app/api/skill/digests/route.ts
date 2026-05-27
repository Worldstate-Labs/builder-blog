import { NextResponse } from "next/server";
import { formatZodError } from "@/lib/zod-error";
import { prisma } from "@/lib/prisma";
import { parseSkillDigestPayload } from "@/lib/skill-contracts";
import { getUserFromBearer } from "@/lib/tokens";

export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseSkillDigestPayload(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
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
