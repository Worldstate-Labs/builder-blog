import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ job: string }> };

const jobSkillFiles = {
  "library-once": "skills/builder-blog-digest/jobs/library-once.md",
  "digest-once": "skills/builder-blog-digest/jobs/digest-once.md",
  "library-cron-setup": "skills/builder-blog-digest/jobs/library-cron-setup.md",
  "digest-cron-setup": "skills/builder-blog-digest/jobs/digest-cron-setup.md",
  "library-cron": "skills/builder-blog-digest/jobs/library-cron.md",
  "digest-cron": "skills/builder-blog-digest/jobs/digest-cron.md",
} as const;

export async function GET(_request: Request, { params }: Params) {
  const { job } = await params;
  const path = jobSkillFiles[job as keyof typeof jobSkillFiles];
  if (!path) {
    return NextResponse.json({ error: "Skill job not found" }, { status: 404 });
  }

  const content = await readFile(join(process.cwd(), path), "utf8");
  return new Response(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
