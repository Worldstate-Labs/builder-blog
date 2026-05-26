import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ file: string }> };

const skillFiles = {
  "builder-blog-digest.md": {
    path: "skills/builder-blog-digest/SKILL.md",
    contentType: "text/markdown; charset=utf-8",
  },
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
  "builder-blog-library-cron.md": {
    path: "skills/builder-blog-digest/jobs/library-cron.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-blog-library-cron-setup.md": {
    path: "skills/builder-blog-digest/jobs/library-cron-setup.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-blog-library-once.md": {
    path: "skills/builder-blog-digest/jobs/library-once.md",
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
  "sources.json": {
    path: "config/sources.json",
    contentType: "application/json; charset=utf-8",
  },
} as const;

export async function GET(_request: Request, { params }: Params) {
  const { file } = await params;
  const asset = skillFiles[file as keyof typeof skillFiles];
  if (!asset) {
    return NextResponse.json({ error: "Skill file not found" }, { status: 404 });
  }

  const content = await readFile(join(process.cwd(), asset.path), "utf8");
  return new Response(content, {
    headers: {
      "content-type": asset.contentType,
      "cache-control": "public, max-age=60",
    },
  });
}
