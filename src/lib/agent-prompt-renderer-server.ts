import type { ExistingCronRecord } from "@/lib/agent-prompt-renderer";
import type { SkillJobName } from "@/lib/skill-job-files";

type RendererServerPrisma = {
  builderPoolEntry: {
    findMany(args: {
      where: { userId: string; removedAt: null };
      select: { builder: { select: { kind: true } } };
    }): Promise<Array<{ builder: { kind: string } | null }>>;
  };
  libraryCronJob: {
    findUnique(args: {
      where: { userId: string };
      select: {
        status: true;
        startedAt: true;
        frequencyLabel: true;
        runtime: true;
        hostname: true;
        updatedAt: true;
      };
    }): Promise<ExistingCronRecord | null>;
  };
  digestCronJob: {
    findUnique(args: {
      where: { userId: string };
      select: {
        status: true;
        startedAt: true;
        frequencyLabel: true;
        runtime: true;
        hostname: true;
        updatedAt: true;
      };
    }): Promise<ExistingCronRecord | null>;
  };
};

const SOURCE_CREDENTIAL_SPECS: {
  kinds: string[];
  envKey: string;
  label: string;
  help: string;
}[] = [
  {
    kinds: ["X"],
    envKey: "X_BEARER_TOKEN",
    label: "X (Twitter)",
    help: "free read-only tier at https://developer.x.com/en/portal/dashboard",
  },
];

export async function buildSourceCredentialPrep(
  prisma: RendererServerPrisma,
  userId: string,
): Promise<string> {
  const entries = await prisma.builderPoolEntry.findMany({
    where: { userId, removedAt: null },
    select: { builder: { select: { kind: true } } },
  });
  const kinds = new Set<string>();
  for (const entry of entries) {
    if (entry.builder?.kind) kinds.add(entry.builder.kind);
  }
  const needed = SOURCE_CREDENTIAL_SPECS.filter((spec) =>
    spec.kinds.some((kind) => kinds.has(kind)),
  );
  if (needed.length === 0) return "";

  const checkJs =
    'const fs=require("fs");const k=process.env.KEY,p=process.env.SECRETS;' +
    'let ok=Boolean((process.env[k]||"").trim());' +
    'if(!ok){let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}' +
    'ok=Boolean(d[k]&&String(d[k]).trim())}' +
    'console.log(k+": "+(ok?"present, already configured. Skip.":"missing, ask the user"))';
  const writeJs =
    'const fs=require("fs");const[p,k,v]=process.argv.slice(1);let d={};' +
    'try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}d[k]=v;fs.writeFileSync(p,JSON.stringify(d,null,2))';

  const blocks = needed
    .map((spec) =>
      [
        `- **${spec.label}** source(s) present -> needs \`${spec.envKey}\` (${spec.help}).`,
        "  Check whether it is already on this machine; only ask the user if missing:",
        "",
        "  ```bash",
        `  SECRETS="\${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/secrets.json"`,
        `  KEY=${spec.envKey} SECRETS="$SECRETS" node -e '${checkJs}'`,
        "  ```",
        "",
        "  If `present`, skip. If `missing`, ask the user for the token and store",
        "  it (preserves other keys):",
        "",
        "  ```bash",
        `  node -e '${writeJs}' "$SECRETS" ${spec.envKey} "PASTE_${spec.envKey}"`,
        '  chmod 600 "$SECRETS"',
        "  ```",
        "",
        "  Asking is optional. If the user declines or has no token yet, do NOT",
        `  block. Continue the setup. The ${spec.label} source(s) will simply be`,
        '  skipped (they surface as "Action needed") until a token is added later.',
      ].join("\n"),
    )
    .join("\n\n");

  return [
    "**Prepare source API credentials (before the initial run).** This account",
    "has sources that fetch through an authenticated API, so the bare cron",
    "environment needs their tokens in the local secrets file. For each one below,",
    "check first and only ask the user when the token is actually missing. Never",
    "re-ask for an already-configured token. Providing a token is optional and",
    "never blocks setup: a source with no token is just skipped, not an error.",
    "",
    blocks,
  ].join("\n");
}

export async function getExistingCronRecord(
  prisma: RendererServerPrisma,
  {
    job,
    accountUserId,
  }: {
    job: SkillJobName;
    accountUserId: string;
  },
): Promise<ExistingCronRecord | null> {
  if (job === "library-cron-setup") {
    return prisma.libraryCronJob.findUnique({
      where: { userId: accountUserId },
      select: {
        status: true,
        startedAt: true,
        frequencyLabel: true,
        runtime: true,
        hostname: true,
        updatedAt: true,
      },
    });
  }
  if (job === "digest-cron-setup") {
    return prisma.digestCronJob.findUnique({
      where: { userId: accountUserId },
      select: {
        status: true,
        startedAt: true,
        frequencyLabel: true,
        runtime: true,
        hostname: true,
        updatedAt: true,
      },
    });
  }
  return null;
}

export function createServerRenderAgentPromptDeps(prisma: RendererServerPrisma) {
  return {
    buildSourceCredentialPrep(accountUserId: string) {
      return buildSourceCredentialPrep(prisma, accountUserId);
    },
    getExistingCronRecord(input: {
      job: SkillJobName;
      accountUserId: string;
    }) {
      return getExistingCronRecord(prisma, input);
    },
  };
}
