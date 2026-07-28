import { createHash } from "node:crypto";
import {
  listAgentSkillFileNames,
  readAgentSkillFile,
} from "@/lib/agent-skill-files";

export const AGENT_SKILL_BUNDLE_SCHEMA_VERSION = 1;

export type AgentSkillBundleEntry = {
  name: string;
  target: string;
  mode: number;
  sha256: string;
  contentBase64: string;
};

export type AgentSkillBundle = {
  schemaVersion: typeof AGENT_SKILL_BUNDLE_SCHEMA_VERSION;
  bundleId: string;
  files: AgentSkillBundleEntry[];
};

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function createAgentSkillBundleId(files: AgentSkillBundleEntry[]): string {
  return sha256(
    JSON.stringify({
      schemaVersion: AGENT_SKILL_BUNDLE_SCHEMA_VERSION,
      files: files.map(({ name, target, mode, sha256: digest }) => ({
        name,
        target,
        mode,
        sha256: digest,
      })),
    }),
  );
}

export async function buildAgentSkillBundle(): Promise<AgentSkillBundle> {
  const files = await Promise.all(
    listAgentSkillFileNames().map(async (name) => {
      const file = await readAgentSkillFile(name);
      const content = Buffer.from(file.content, "utf8");
      return {
        name: file.name,
        target: file.target,
        mode: file.mode,
        sha256: sha256(content),
        contentBase64: content.toString("base64"),
      };
    }),
  );

  return {
    schemaVersion: AGENT_SKILL_BUNDLE_SCHEMA_VERSION,
    bundleId: createAgentSkillBundleId(files),
    files,
  };
}
