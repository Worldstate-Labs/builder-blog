import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { jobSkillFiles } from "@/lib/skill-job-files";
import { hashToken } from "@/lib/tokens";

type Params = { params: Promise<{ job: string }> };

export async function GET(request: Request, { params }: Params) {
  const { job } = await params;
  const path = jobSkillFiles[job as keyof typeof jobSkillFiles];
  if (!path) {
    return NextResponse.json({ error: "Skill job not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const tokenParam = url.searchParams.get("token");

  let content = await readFile(join(process.cwd(), path), "utf8");

  if (tokenParam) {
    // Validate the token — only embed if it resolves to an active AgentToken
    const { prisma } = await import("@/lib/prisma");
    const record = await prisma.agentToken.findUnique({
      where: { tokenHash: hashToken(tokenParam) },
      select: { revokedAt: true },
    });

    if (!record || record.revokedAt) {
      return NextResponse.json({ error: "Invalid or revoked token" }, { status: 403 });
    }

    // Inject BUILDER_BLOG_TOKEN into every fenced bash block so the CLI has
    // the token available without requiring config.json or a login flow.
    // Strategy: prepend an export line as the first statement of each ```bash block.
    const exportLine = `BUILDER_BLOG_TOKEN="${tokenParam}"`;
    content = content.replace(/^```bash\n/gm, `\`\`\`bash\n${exportLine}\n`);
  }

  return new Response(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
