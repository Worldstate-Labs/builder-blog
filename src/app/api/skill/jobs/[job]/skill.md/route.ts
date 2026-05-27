import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { jobSkillFiles } from "@/lib/skill-job-files";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ job: string }> };

export async function GET(request: Request, { params }: Params) {
  const { job } = await params;
  const path = jobSkillFiles[job as keyof typeof jobSkillFiles];
  if (!path) {
    return NextResponse.json({ error: "Skill job not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const ecParam = url.searchParams.get("ec");

  // Reject any ec value that doesn't match the exchange-code format so it
  // can never carry shell metacharacters into the generated bash block.
  if (ecParam && !/^bb_ec_[A-Za-z0-9_-]{8,256}$/.test(ecParam)) {
    return NextResponse.json(
      { error: "Exchange code invalid" },
      { status: 400 },
    );
  }

  let content = await readFile(join(process.cwd(), path), "utf8");

  if (ecParam) {
    // Validate the exchange code: must exist, not expired, not yet used.
    // Do NOT mark usedAt here — only the CLI exchange endpoint marks it.
    const record = await prisma.exchangeCode.findUnique({
      where: { code: ecParam },
      include: {
        agentToken: {
          include: { user: { select: { email: true } } },
        },
      },
    });

    if (!record || record.expiresAt < new Date()) {
      return NextResponse.json({ error: "Exchange code invalid or expired" }, { status: 403 });
    }

    const email = record.agentToken.user.email ?? "";

    // 1. Prepend the exchange step as the very first bash block
    const exchangeBlock = [
      "Exchange the one-time setup code for an agent token (writes to",
      `\`~/.builder-blog/accounts/${email}.json\`). The code is used once and expires.\n`,
      "```bash",
      `mkdir -p "\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/accounts"`,
      `node "\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" exchange --ec "${ecParam}"`,
      "```\n",
    ].join("\n");

    // Insert before the first heading or content
    content = exchangeBlock + "\n" + content;

    // 2. Rewrite every bash block: prepend BUILDER_BLOG_ACCOUNT env to node ... builder-digest.mjs ... lines
    const accountEnv = `BUILDER_BLOG_ACCOUNT="${email}"`;
    content = content.replace(/^```bash\n([\s\S]*?)^```/gm, (_match, blockBody) => {
      const rewritten = blockBody.replace(
        /(^|\\\n\s*)(node\s+[^\n]*builder-digest\.mjs[^\n]*)/gm,
        (_m: string, prefix: string, nodeCmd: string) => `${prefix}${accountEnv} \\\n${nodeCmd}`,
      );
      return "```bash\n" + rewritten + "```";
    });
  }

  return new Response(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
