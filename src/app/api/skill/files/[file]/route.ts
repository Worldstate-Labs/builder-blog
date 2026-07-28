import { NextResponse } from "next/server";
import {
  isAgentSkillFileName,
  readAgentSkillFile,
} from "@/lib/agent-skill-files";

type Params = { params: Promise<{ file: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { file } = await params;
  if (!isAgentSkillFileName(file)) {
    return NextResponse.json({ error: "Skill file not found" }, { status: 404 });
  }

  const asset = await readAgentSkillFile(file);
  return new Response(asset.content, {
    headers: {
      "content-type": asset.contentType,
      "cache-control": "public, max-age=60",
    },
  });
}
