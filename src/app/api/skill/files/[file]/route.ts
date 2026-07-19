import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { expandSkillIncludes } from "@/lib/skill-includes";

type Params = { params: Promise<{ file: string }> };

const skillFiles = {
  "builder-blog-digest-cron.md": {
    path: "skills/builder-blog-digest/jobs/digest-cron.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-blog-digest-cron-setup.md": {
    path: "skills/builder-blog-digest/jobs/digest-cron-setup.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-blog-digest-once.md": {
    path: "skills/builder-blog-digest/jobs/digest-once.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-blog-library-cron-setup.md": {
    path: "skills/builder-blog-digest/jobs/library-cron-setup.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-blog-cloud-library-cron.md": {
    path: "skills/builder-blog-digest/jobs/cloud-library-cron.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-blog-cloud-library-host.md": {
    path: "skills/builder-blog-digest/jobs/cloud-library-host.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-blog-library-once.md": {
    path: "skills/builder-blog-digest/jobs/library-once.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-blog-library-worker.md": {
    path: "skills/builder-blog-digest/jobs/library-worker.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-blog-library-discovery.md": {
    path: "skills/builder-blog-digest/jobs/library-discovery.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-agent-runner.sh": {
    path: "scripts/builder-agent-runner.sh",
    contentType: "text/x-shellscript; charset=utf-8",
  },
  "builder-digest.mjs": {
    path: "scripts/builder-digest.mjs",
    contentType: "text/javascript; charset=utf-8",
  },
  "cloud-shard-budget.mjs": {
    path: "scripts/cloud-shard-budget.mjs",
    contentType: "text/javascript; charset=utf-8",
  },
  "sources.json": {
    path: "config/sources.json",
    contentType: "application/json; charset=utf-8",
  },
  "local-agent-timeouts.json": {
    path: "config/local-agent-timeouts.json",
    contentType: "application/json; charset=utf-8",
  },
} as const;

export async function GET(_request: Request, { params }: Params) {
  const { file } = await params;
  const asset = Object.prototype.hasOwnProperty.call(skillFiles, file)
    ? skillFiles[file as keyof typeof skillFiles]
    : undefined;
  if (!asset) {
    return NextResponse.json({ error: "Skill file not found" }, { status: 404 });
  }

  const raw = await readFile(join(process.cwd(), asset.path), "utf8");
  // Expand {{INCLUDE:...}} directives so the library job prompts share one
  // copy of the fetch-task contract. No-op for files without directives.
  let content = await expandSkillIncludes(raw);
  // These placeholders are per-copy settings, normally substituted by the jobs
  // route from query params. The raw file is also served here (the runner
  // refreshes its local copy from this route), so neutralize them to the normal
  // auto-runtime, non-override path.
  content = content.replaceAll("{{AGENT_RUNTIME}}", "");
  content = content.replaceAll("{{FETCH_FLAG}}", "");
  content = content.replaceAll("{{FETCH_DAYS}}", "30");
  content = content.replaceAll("{{PARALLEL_WORKERS}}", "10");
  content = content.replaceAll("{{FETCH_LIMIT}}", "3");
  return new Response(content, {
    headers: {
      "content-type": asset.contentType,
      "cache-control": "public, max-age=60",
    },
  });
}
