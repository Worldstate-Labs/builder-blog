import { NextResponse } from "next/server";
import {
  renderAgentPrompt,
  type ExistingCronRecord,
  type NormalizedAgentPromptRenderOptions,
} from "@/lib/agent-prompt-renderer";
import { jobSkillFiles } from "@/lib/skill-job-files";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ job: string }> };

function boundedIntegerParam(
  searchParams: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Number(searchParams.get(name) ?? String(fallback));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

// Source-type-aware credential prep for the library cron setup prompt. The web
// copy-prompt flow resolves the account from the exchange code, so we can tell
// the agent up front which sources need a local API token in secrets.json —
// instead of only finding out when the initial setup run surfaces an
// *_token_missing notice. Read-only; returns "" when no credentialed sources.
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

async function buildSourceCredentialPrep(userId: string): Promise<string> {
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

  // This runs on the user's machine (the server can't see their secrets.json):
  // checkJs reports present/missing with the same lookup as the runner — env,
  // then the single top-level token (one app-scoped X token serves the whole
  // host) — so we never re-ask for an already-configured token.
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
        `- **${spec.label}** source(s) present → needs \`${spec.envKey}\` (${spec.help}).`,
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

export async function GET(request: Request, { params }: Params) {
  const { job } = await params;
  const path = jobSkillFiles[job as keyof typeof jobSkillFiles];
  if (!path) {
    return NextResponse.json({ error: "Skill job not found" }, { status: 404 });
  }
  const skillJob = job as keyof typeof jobSkillFiles;

  const url = new URL(request.url);
  const ecParam = url.searchParams.get("ec");
  const openClawSetupChild = url.searchParams.get("openclaw_setup_child") === "1";
  const setupAccountParam = url.searchParams.get("setup_account");

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
  const runtimeAllowed = new Set(["claude", "codex", "hermes", "openclaw"] as const);
  const runtime =
    runtimeRaw && runtimeAllowed.has(runtimeRaw as (typeof runtimeAllowed extends Set<infer T> ? T : never))
      ? (runtimeRaw as NormalizedAgentPromptRenderOptions["runtime"])
      : null;

  // Cron cadence for cron-setup prompts. Whitelisted key → fixed interval
  // metadata; the concrete cron/launchd schedule is generated on the user's
  // machine from the install-time anchor after validation succeeds.
  const cronFrequencies: Record<NonNullable<NormalizedAgentPromptRenderOptions["frequency"]>, { label: string }> = {
    "1h": { label: "Hourly" },
    daily: { label: "Daily" },
    weekly: { label: "Weekly" },
  };
  const defaultFreq = "daily";
  const freqRaw = url.searchParams.get("freq");
  const freq = (freqRaw && cronFrequencies[freqRaw as keyof typeof cronFrequencies]
    ? freqRaw
    : defaultFreq) as NormalizedAgentPromptRenderOptions["frequency"];
  const fetchForce = url.searchParams.get("force") === "1";
  const fetchDays = boundedIntegerParam(url.searchParams, "days", 30, 1, 90);
  const isLibraryJob = job.startsWith("library") || job.startsWith("cloud-library");
  const isDigestJob = job.startsWith("digest");
  const parallelDefault = 10;
  const parallelMax = 20;
  const parallelRaw = Number(url.searchParams.get("parallel") ?? String(parallelDefault));
  const parallelWorkers =
    (isLibraryJob || isDigestJob) &&
    Number.isFinite(parallelRaw) &&
    Number.isInteger(parallelRaw) &&
    parallelRaw >= 1
      ? Math.min(parallelMax, Math.floor(parallelRaw))
      : parallelDefault;
  const fetchLimit = boundedIntegerParam(url.searchParams, "postLimit", 3, 1, 20);

  const isCronSetupJob = job === "library-cron-setup" || job === "digest-cron-setup";
  let exchange:
    | {
        code: string;
        accountEmail: string;
        accountUserId: string;
      }
    | undefined;
  let openClawChild:
    | {
        accountEmail: string;
      }
    | undefined;
  if (ecParam) {
    // Validate the exchange code while rendering the user-facing setup prompt.
    // The exchange endpoint deletes this row after successful exchange, so the
    // queued OpenClaw child prompt must not depend on this code being reusable.
    const record = await prisma.exchangeCode.findUnique({
      where: { code: ecParam },
      include: {
        agentToken: {
          include: { user: { select: { email: true, id: true } } },
        },
      },
    });

    if (!record || record.expiresAt < new Date() || record.agentToken.revokedAt) {
      return NextResponse.json({ error: "Exchange code invalid or expired" }, { status: 403 });
    }

    exchange = {
      code: ecParam,
      accountEmail: record.agentToken.user.email ?? "",
      accountUserId: record.agentToken.user.id,
    };
  } else if (openClawSetupChild && isCronSetupJob) {
    if (!setupAccountParam || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(setupAccountParam)) {
      return NextResponse.json({ error: "Setup account missing or invalid" }, { status: 400 });
    }
    openClawChild = { accountEmail: setupAccountParam };
  }

  const options: NormalizedAgentPromptRenderOptions = {
    runtime,
    frequency: freq,
    force: fetchForce,
    fetchDays,
    parallelWorkers,
    fetchLimit,
  };

  const content = await renderAgentPrompt(
    {
      origin: url.origin,
      job: skillJob,
      options,
      exchange,
      openClawChild,
    },
    {
      buildSourceCredentialPrep,
      getExistingCronRecord: async ({
        job: cronJob,
        accountUserId,
      }): Promise<ExistingCronRecord | null> => {
        if (cronJob === "library-cron-setup") {
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
        if (cronJob === "digest-cron-setup") {
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
      },
    },
  );

  return new Response(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
