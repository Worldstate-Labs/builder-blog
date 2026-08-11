import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expandSkillIncludes } from "@/lib/skill-includes";

type AgentSkillFileDefinition = {
  sourcePath: string;
  target: string;
  contentType: string;
  mode: 0o644 | 0o755;
};

export const agentSkillFiles = {
  "builder-blog-digest-cron.md": {
    sourcePath: "skills/builder-blog-digest/jobs/digest-cron.md",
    target: "jobs/digest-cron.md",
    contentType: "text/markdown; charset=utf-8",
    mode: 0o644,
  },
  "builder-blog-digest-cron-setup.md": {
    sourcePath: "skills/builder-blog-digest/jobs/digest-cron-setup.md",
    target: "jobs/digest-cron-setup.md",
    contentType: "text/markdown; charset=utf-8",
    mode: 0o644,
  },
  "builder-blog-digest-once.md": {
    sourcePath: "skills/builder-blog-digest/jobs/digest-once.md",
    target: "jobs/digest-once.md",
    contentType: "text/markdown; charset=utf-8",
    mode: 0o644,
  },
  "builder-blog-library-cron-setup.md": {
    sourcePath: "skills/builder-blog-digest/jobs/library-cron-setup.md",
    target: "jobs/library-cron-setup.md",
    contentType: "text/markdown; charset=utf-8",
    mode: 0o644,
  },
  "builder-blog-cloud-library-cron.md": {
    sourcePath: "skills/builder-blog-digest/jobs/cloud-library-cron.md",
    target: "jobs/cloud-library-cron.md",
    contentType: "text/markdown; charset=utf-8",
    mode: 0o644,
  },
  "builder-blog-cloud-library-host.md": {
    sourcePath: "skills/builder-blog-digest/jobs/cloud-library-host.md",
    target: "jobs/cloud-library-host.md",
    contentType: "text/markdown; charset=utf-8",
    mode: 0o644,
  },
  "builder-blog-library-once.md": {
    sourcePath: "skills/builder-blog-digest/jobs/library-once.md",
    target: "jobs/library-once.md",
    contentType: "text/markdown; charset=utf-8",
    mode: 0o644,
  },
  "builder-blog-library-worker.md": {
    sourcePath: "skills/builder-blog-digest/jobs/library-worker.md",
    target: "jobs/library-worker.md",
    contentType: "text/markdown; charset=utf-8",
    mode: 0o644,
  },
  "builder-blog-library-discovery.md": {
    sourcePath: "skills/builder-blog-digest/jobs/library-discovery.md",
    target: "jobs/library-discovery.md",
    contentType: "text/markdown; charset=utf-8",
    mode: 0o644,
  },
  "builder-agent-runner.sh": {
    sourcePath: "scripts/builder-agent-runner.sh",
    target: "builder-agent-runner.sh",
    contentType: "text/x-shellscript; charset=utf-8",
    mode: 0o755,
  },
  "builder-library-cron-install.sh": {
    sourcePath: "scripts/builder-library-cron-install.sh",
    target: "builder-library-cron-install.sh",
    contentType: "text/x-shellscript; charset=utf-8",
    mode: 0o755,
  },
  "builder-digest.mjs": {
    sourcePath: "scripts/builder-digest.mjs",
    target: "builder-digest.mjs",
    contentType: "text/javascript; charset=utf-8",
    mode: 0o755,
  },
  "new-product-launches.mjs": {
    sourcePath: "scripts/new-product-launches.mjs",
    target: "new-product-launches.mjs",
    contentType: "text/javascript; charset=utf-8",
    mode: 0o644,
  },
  "cloud-shard-budget.mjs": {
    sourcePath: "scripts/cloud-shard-budget.mjs",
    target: "cloud-shard-budget.mjs",
    contentType: "text/javascript; charset=utf-8",
    mode: 0o644,
  },
  "run-storage.mjs": {
    sourcePath: "scripts/run-storage.mjs",
    target: "run-storage.mjs",
    contentType: "text/javascript; charset=utf-8",
    mode: 0o644,
  },
  "install-agent-skill-bundle.cjs": {
    sourcePath: "scripts/install-agent-skill-bundle.cjs",
    target: "install-agent-skill-bundle.cjs",
    contentType: "text/javascript; charset=utf-8",
    mode: 0o644,
  },
  "sources.json": {
    sourcePath: "config/sources.json",
    target: "sources.json",
    contentType: "application/json; charset=utf-8",
    mode: 0o644,
  },
  "local-agent-timeouts.json": {
    sourcePath: "config/local-agent-timeouts.json",
    target: "local-agent-timeouts.json",
    contentType: "application/json; charset=utf-8",
    mode: 0o644,
  },
} as const satisfies Record<string, AgentSkillFileDefinition>;

export type AgentSkillFileName = keyof typeof agentSkillFiles;

export function isAgentSkillFileName(value: string): value is AgentSkillFileName {
  return Object.prototype.hasOwnProperty.call(agentSkillFiles, value);
}

export function listAgentSkillFileNames(): AgentSkillFileName[] {
  return Object.keys(agentSkillFiles) as AgentSkillFileName[];
}

export async function readAgentSkillFile(name: AgentSkillFileName) {
  const definition = agentSkillFiles[name];
  const raw = await readFile(join(process.cwd(), definition.sourcePath), "utf8");
  let content = await expandSkillIncludes(raw);

  content = content.replaceAll("{{AGENT_RUNTIME}}", "");
  content = content.replaceAll("{{FETCH_FLAG}}", "");
  content = content.replaceAll("{{FETCH_DAYS}}", "30");
  content = content.replaceAll("{{PARALLEL_WORKERS}}", "10");
  content = content.replaceAll("{{FETCH_LIMIT}}", "3");
  content = content.replaceAll("{{EXCHANGE_BLOCK}}", "");

  return {
    name,
    ...definition,
    content,
  };
}
