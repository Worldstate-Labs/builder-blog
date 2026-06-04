import type { AgentJobRunListItem } from "@/lib/agent-job-runs";
import type { DigestCronJobStatus } from "@/lib/digest-runs";

export type ChipStyle = { background: string; color: string; border: string };

export type DigestCronRunStatusInput = {
  id?: string;
  status: string;
  source: string;
  preparedAt: string;
};

export type CronSlotStatus = "ok" | "failed" | "missed" | "waiting" | "running" | "stalled";

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

function addScheduleInterval(date: Date, cronJob: DigestCronJobStatus, steps = 1): Date {
  const next = new Date(date);
  switch (cronJob.frequencyKey) {
    case "daily":
      next.setDate(next.getDate() + steps);
      return next;
    case "weekly":
      next.setDate(next.getDate() + steps * 7);
      return next;
    default:
      return new Date(date.getTime() + cronJob.intervalMinutes * 60_000 * steps);
  }
}

function floorToExpectedSchedule(now: Date, cronJob: DigestCronJobStatus): Date {
  const value = new Date(now);
  value.setSeconds(0, 0);

  switch (cronJob.frequencyKey) {
    case "30m":
      value.setMinutes(value.getMinutes() >= 30 ? 30 : 0);
      return value;
    case "1h":
      value.setMinutes(0);
      return value;
    case "3h":
    case "6h":
    case "12h": {
      const hours = cronJob.intervalMinutes / 60;
      value.setHours(Math.floor(value.getHours() / hours) * hours, 0, 0, 0);
      return value;
    }
    case "daily":
      value.setHours(8, 0, 0, 0);
      if (value.getTime() > now.getTime()) value.setDate(value.getDate() - 1);
      return value;
    case "weekly": {
      value.setHours(8, 0, 0, 0);
      const daysSinceMonday = (value.getDay() + 6) % 7;
      value.setDate(value.getDate() - daysSinceMonday);
      if (value.getTime() > now.getTime()) value.setDate(value.getDate() - 7);
      return value;
    }
    default: {
      const startedAt = Date.parse(cronJob.startedAt);
      const intervalMs = Math.max(1, cronJob.intervalMinutes) * 60_000;
      const elapsed = now.getTime() - startedAt;
      const slotIndex = Number.isFinite(elapsed) && elapsed > 0 ? Math.floor(elapsed / intervalMs) : 0;
      return new Date(startedAt + slotIndex * intervalMs);
    }
  }
}

function cronGraceMs(cronJob: DigestCronJobStatus): number {
  const minutes = Math.min(30, Math.max(5, Math.round(cronJob.intervalMinutes * 0.1)));
  return minutes * 60_000;
}

export function isActiveDigestJobRun(jobRun: AgentJobRunListItem): boolean {
  return jobRun.status === "starting" || jobRun.status === "running";
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
  const startedAt = Date.parse(cronJob.startedAt);
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
    if (cursor.getTime() >= startedAt) {
      expected.unshift(new Date(cursor));
    }
    cursor = addScheduleInterval(cursor, cronJob, -1);
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
    const status: CronSlotStatus = jobRun
      ? jobRunSlotStatus(jobRun, nowMs)
      : match
      ? match.status === "synced"
        ? "ok"
        : "failed"
      : nowMs - expectedMs <= graceMs
        ? "waiting"
        : "missed";
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

export function getDigestUpdateStatus(
  cronJob: DigestCronJobStatus | null,
  slots: CronSlot[],
  runs: DigestCronRunStatusInput[],
): DigestUpdateStatus {
  const activeRun = runs.find(isDigestRunInflight);
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
      summary: "No local helper schedule has reported yet.",
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

  const problemCount = slots.filter((slot) => slot.status === "missed" || slot.status === "failed").length;
  const okCount = slots.filter((slot) => slot.status === "ok").length;
  if (problemCount > 0) {
    return {
      key: "needs-attention",
      label: "Needs attention",
      summary: `${problemCount} scheduled ${problemCount === 1 ? "run needs" : "runs need"} review.`,
      style: statusStyle("failed"),
    };
  }
  if (okCount > 0) {
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
    summary: "The schedule is active; the first expected run has not finished yet.",
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
        background: "var(--warm-soft)",
        color: "color-mix(in oklch, var(--warm) 68%, var(--ink))",
        border: "color-mix(in oklch, var(--warm) 30%, var(--line))",
      };
  }
}
