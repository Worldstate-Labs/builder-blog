import { NextResponse } from "next/server";
import {
  renderAgentPrompt,
  type NormalizedAgentPromptRenderOptions,
} from "@/lib/agent-prompt-renderer";
import { createServerRenderAgentPromptDeps } from "@/lib/agent-prompt-renderer-server";
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
  const serverRenderDeps = createServerRenderAgentPromptDeps(prisma);

  const content = await renderAgentPrompt(
    {
      origin: url.origin,
      job: skillJob,
      options,
      exchange,
      openClawChild,
    },
    serverRenderDeps,
  );

  return new Response(content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
