import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { jobSkillFiles } from "@/lib/skill-job-files";
import { expandSkillIncludes } from "@/lib/skill-includes";
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

  // Runtime hint for cron-setup prompts: which agent will execute the
  // scheduled job. We pin it server-side instead of letting the
  // discovery chain pick whatever's first on PATH, so the unattended
  // permission flags can be exact for that runtime. Whitelisted to a
  // closed set so no shell metacharacters slip into the rendered md.
  const runtimeRaw = url.searchParams.get("runtime");
  const runtimeAllowed = new Set(["claude", "codex", "gemini", "openclaw"]);
  const runtime = runtimeRaw && runtimeAllowed.has(runtimeRaw) ? runtimeRaw : null;
  const runtimeLabels: Record<string, string> = {
    claude: "Claude Code",
    codex: "Codex",
    gemini: "Gemini CLI",
    openclaw: "OpenClaw",
  };

  let content = await readFile(join(process.cwd(), path), "utf8");
  // Expand {{INCLUDE:...}} directives (shared fetch-task contract) before
  // the exchange-code / runtime substitutions below.
  content = await expandSkillIncludes(content);

  // Substitute runtime placeholders. Markdown that doesn't use them
  // is unaffected; cron-setup prompts use `{{AGENT_RUNTIME}}` and
  // `{{AGENT_RUNTIME_LABEL}}` to print the choice and write it to
  // ~/.builder-blog/runtime so the runner picks the right unattended
  // invocation. When no runtime is pinned we keep the placeholders as
  // empty strings — the runner falls back to its discovery chain.
  content = content
    .replaceAll("{{AGENT_RUNTIME}}", runtime ?? "")
    .replaceAll("{{AGENT_RUNTIME_LABEL}}", runtime ? runtimeLabels[runtime] : "your local agent");

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

    // 2. Rewrite every bash block: replace any placeholder
    //    `BUILDER_BLOG_ACCOUNT="..." \` line that precedes a
    //    `node ... builder-digest.mjs ...` command with the resolved
    //    email, or prepend one when the command stands alone. Replacing
    //    (not prepending) keeps the rendered block at one ACCOUNT= line
    //    per node call instead of stacking the placeholder and the
    //    resolved value on top of each other.
    const accountEnv = `BUILDER_BLOG_ACCOUNT="${email}"`;
    content = content.replace(/^```bash\n([\s\S]*?)^```/gm, (_match, blockBody) => {
      const rewritten = blockBody.replace(
        /(^|\n)(?:BUILDER_BLOG_ACCOUNT="[^"]*"\s*\\\n)?(node\s+[^\n]*builder-digest\.mjs[^\n]*)/gm,
        (_m: string, lineStart: string, nodeCmd: string) =>
          `${lineStart}${accountEnv} \\\n${nodeCmd}`,
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
