import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ file: string }> };

const skillFiles = {
  "builder-blog-digest.md": {
    path: "skills/builder-blog-digest/SKILL.md",
    contentType: "text/markdown; charset=utf-8",
  },
  "builder-digest.mjs": {
    path: "scripts/builder-digest.mjs",
    contentType: "text/javascript; charset=utf-8",
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
