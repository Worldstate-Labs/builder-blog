import type { AgentJobRunListItem } from "@/lib/agent-job-runs";
import type { DigestCronJobStatus } from "@/lib/digest-runs";
import { addScheduleInterval, firstExpectedSchedule, floorToExpectedSchedule } from "@/lib/schedule-timing";

export type ChipStyle = { background: string; color: string; border: string };

export type DigestCronRunStatusInput = {
  id?: string;
  status: string;
  source: string;
  preparedAt: string;
};

export type CronSlotStatus = "ok" | "partial" | "failed" | "missed" | "waiting" | "running" | "stalled" | "stopped" | "replaced";

export type CronSlot<Run extends DigestCronRunStatusInput = DigestCronRunStatusInput> = {
  expectedAt: string;
  windowEnd: string;
  status: CronSlotStatus;
  run: Run | null;
  jobRun: AgentJobRunListItem | null;
};

export type DigestUpdateStatusKey =
  | "not-connected"
  | "stopped"
  | "building"
  | "waiting"
  | "healthy"
  | "needs-attention";

export type DigestUpdateStatus = {
  key: DigestUpdateStatusKey;
  label: string;
  summary: string;
  style: ChipStyle;
};

const PREPARED_RUN_MAX_AGE_MS = 30 * 60_000;
const CRON_SLOT_LIMIT = 12;

export function isDigestRunInflight(run: DigestCronRunStatusInput): boolean {
  const ageMs = Date.now() - Date.parse(run.preparedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > PREPARED_RUN_MAX_AGE_MS) return false;
  return run.status !== "synced";
}

function cronGraceMs(cronJob: DigestCronJobStatus): number {
  const minutes = Math.min(30, Math.max(5, Math.round(cronJob.intervalMinutes * 0.1)));
  return minutes * 60_000;
}

export function isActiveDigestJobRun(jobRun: AgentJobRunListItem): boolean {
  return jobRun.status === "starting" || jobRun.status === "running";
}

export function digestCronFrequencyLabel(cronJob: DigestCronJobStatus | null): string {
  if (!cronJob) return "Not scheduled";
  if (cronJob.status !== "active") return "Stopped";
  return cronJob.frequencyLabel || "Scheduled";
}

function isStalledJobRun(jobRun: AgentJobRunListItem, nowMs = Date.now()): boolean {
  if (!isActiveDigestJobRun(jobRun)) return false;
  const heartbeatMs = Date.parse(jobRun.heartbeatAt ?? jobRun.startedAt);
  return Number.isFinite(heartbeatMs) && nowMs - heartbeatMs > 2 * 60_000;
}

function jobRunSlotStatus(jobRun: AgentJobRunListItem, nowMs = Date.now()): CronSlotStatus {
  if (jobRun.status === "succeeded") return "ok";
  if (isStalledJobRun(jobRun, nowMs)) return "stalled";
  if (isActiveDigestJobRun(jobRun)) return "running";
  return "failed";
}

function digestSlotStatusForRun(
  run: DigestCronRunStatusInput | null,
  jobRun: AgentJobRunListItem | null,
  nowMs = Date.now(),
): CronSlotStatus | null {
  if (!run) return null;
  const terminalFailedJob =
    jobRun && !["starting", "running", "succeeded"].includes(jobRun.status);
  if (terminalFailedJob) return "failed";
  if (run.status === "synced") return "ok";
  return jobRun ? jobRunSlotStatus(jobRun, nowMs) : "failed";
}

export function buildDigestCronStatus<Run extends DigestCronRunStatusInput>(
  cronJob: DigestCronJobStatus | null,
  runs: Run[],
  scheduledJobRuns: AgentJobRunListItem[] = [],
  nowMs = Date.now(),
): { slots: CronSlot<Run>[]; nextExpectedAt: string | null } {
  if (!cronJob || cronJob.status !== "active" || cronJob.intervalMinutes <= 0) {
    return { slots: [], nextExpectedAt: null };
  }

  const now = new Date(nowMs);
  const firstExpectedAt = firstExpectedSchedule(cronJob);
  const firstExpectedMs = firstExpectedAt?.getTime() ?? Number.NaN;
  const graceMs = cronGraceMs(cronJob);
  const cronRuns = runs
    .filter((run) => run.source === "cron")
    .map((run) => ({ run, startedMs: Date.parse(run.preparedAt) }))
    .filter(({ startedMs }) => Number.isFinite(startedMs))
    .sort((a, b) => a.startedMs - b.startedMs);

  let cursor = floorToExpectedSchedule(now, cronJob);
  const nextExpected = addScheduleInterval(cursor, cronJob);
  const expected: Date[] = [];
  for (let index = 0; index < CRON_SLOT_LIMIT * 3 && expected.length < CRON_SLOT_LIMIT; index += 1) {
    if (Number.isFinite(firstExpectedMs) && cursor.getTime() >= firstExpectedMs) {
      expected.unshift(new Date(cursor));
    }
    cursor = addScheduleInterval(cursor, cronJob, -1);
  }
  const nextExpectedMs = nextExpected.getTime();
  const expectedTimes = new Set(expected.map((date) => date.getTime()));
  if (
    Number.isFinite(firstExpectedMs) &&
    Number.isFinite(nextExpectedMs) &&
    nextExpectedMs >= firstExpectedMs &&
    nextExpectedMs > nowMs &&
    !expectedTimes.has(nextExpectedMs)
  ) {
    expected.push(nextExpected);
  }

  const slots = expected.map((expectedAt) => {
    const windowEnd = addScheduleInterval(expectedAt, cronJob);
    const expectedMs = expectedAt.getTime();
    const endMs = windowEnd.getTime();
    const match = cronRuns.find(
      ({ startedMs }) => startedMs >= expectedMs - graceMs && startedMs < endMs,
    )?.run ?? null;
    const jobRun = scheduledJobRuns.find((candidate) => {
      if (candidate.trigger !== "scheduled") return false;
      const candidateMs = Date.parse(candidate.expectedAt ?? candidate.startedAt);
      return Number.isFinite(candidateMs) && candidateMs >= expectedMs - graceMs && candidateMs < endMs;
    }) ?? null;
    const runStatus = digestSlotStatusForRun(match, jobRun, nowMs);
    const status: CronSlotStatus = runStatus ?? (
      jobRun
        ? jobRunSlotStatus(jobRun, nowMs)
        : nowMs - expectedMs <= graceMs
          ? "waiting"
          : "missed"
    );
    return {
      expectedAt: expectedAt.toISOString(),
      windowEnd: windowEnd.toISOString(),
      status,
      run: match,
      jobRun,
    };
  });

  return { slots, nextExpectedAt: nextExpected.toISOString() };
}

export type ResolvedSlotStatus = "ok" | "partial" | "missed" | "failed";

// The status chip judges only the most recent window that has a settled
// outcome; waiting/running/stalled windows are still undecided and skipped.
export function latestResolvedSlotStatus(
  slots: ReadonlyArray<{ status: CronSlotStatus }>,
): ResolvedSlotStatus | null {
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    const status = slots[index].status;
    if (status === "ok" || status === "partial" || status === "missed" || status === "failed") return status;
  }
  return null;
}

export function getDigestUpdateStatus(
  cronJob: DigestCronJobStatus | null,
  slots: CronSlot[],
  runs: DigestCronRunStatusInput[],
): DigestUpdateStatus {
  const activeRun = runs.find((run) => {
    if (!isDigestRunInflight(run)) return false;
    return cronJob?.status === "active" ? run.source === "cron" : true;
  });
  if (activeRun) {
    return {
      key: "building",
      label: "Building",
      summary: "A digest build has started and is waiting to be saved.",
      style: statusStyle("partial"),
    };
  }
  if (!cronJob) {
    return {
      key: "not-connected",
      label: "Not connected",
      summary: "No Local Agent schedule is connected.",
      style: statusStyle("partial"),
    };
  }
  if (cronJob.status !== "active") {
    return {
      key: "stopped",
      label: "Stopped",
      summary: "The recurring digest schedule is stopped.",
      style: statusStyle("partial"),
    };
  }

  const latestResolved = latestResolvedSlotStatus(slots);
  if (latestResolved === "partial") {
    return {
      key: "needs-attention",
      label: "Partial",
      summary: "The latest scheduled digest run completed with partial results.",
      style: statusStyle("partial"),
    };
  }
  if (latestResolved === "missed" || latestResolved === "failed") {
    return {
      key: "needs-attention",
      label: "Needs attention",
      summary:
        latestResolved === "missed"
          ? "No run started in the latest scheduled window."
          : "The latest scheduled run did not save an AI Digest.",
      style: statusStyle("failed"),
    };
  }
  if (latestResolved === "ok") {
    return {
      key: "healthy",
      label: "Healthy",
      summary: "Recent scheduled digest runs are saving successfully.",
      style: statusStyle("ok"),
    };
  }

  return {
    key: "waiting",
    label: "Waiting",
    summary: "The schedule is active; no scheduled window has completed yet.",
    style: statusStyle("partial"),
  };
}

export function statusStyle(status: "ok" | "partial" | "failed"): ChipStyle {
  switch (status) {
    case "ok":
      return {
        background: "var(--signal-soft)",
        color: "color-mix(in oklch, var(--signal) 72%, var(--ink))",
        border: "color-mix(in oklch, var(--signal) 28%, var(--line))",
      };
    case "failed":
      return {
        background: "var(--danger-soft)",
        color: "var(--danger)",
        border: "color-mix(in oklch, var(--danger) 30%, var(--line))",
      };
    default:
      return {
        background: "var(--status-partial-soft)",
        color: "color-mix(in oklch, var(--status-partial) 76%, var(--ink))",
        border: "color-mix(in oklch, var(--status-partial) 34%, var(--line))",
      };
  }
}
