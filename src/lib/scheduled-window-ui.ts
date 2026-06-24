import type { AgentJobRunListItem } from "@/lib/agent-job-runs";

export type ScheduledWindowStatus = "ok" | "partial" | "failed" | "missed" | "running" | "stalled" | "stopped" | "replaced" | "waiting";

export type ScheduledWindowStyleStatus = "ok" | "partial" | "failed";

export function scheduledWindowStyleStatus(status: ScheduledWindowStatus): ScheduledWindowStyleStatus {
  if (status === "ok") return "ok";
  if (status === "failed" || status === "missed" || status === "stalled") return "failed";
  return "partial";
}

export function scheduledWindowStatusLabel(status: ScheduledWindowStatus): string {
  if (status === "ok") return "Succeeded";
  if (status === "partial") return "Partial";
  if (status === "failed") return "Failed";
  if (status === "missed") return "Missed";
  if (status === "running") return "Running";
  if (status === "stalled") return "Stalled";
  if (status === "stopped") return "Stopped";
  if (status === "replaced") return "Replaced";
  return "Waiting";
}

export function scheduledJobRunStatusLabel(status: string): string {
  switch (status) {
    case "succeeded":
      return "Succeeded";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "timed_out":
      return "Timed out";
    case "killed":
      return "Killed";
    case "stale":
      return "Stopped";
    case "replaced":
      return "Replaced";
    case "failed":
      return "Failed";
    default:
      return status.replace(/_/g, " ");
  }
}

export function scheduledRunTriggerLabel(
  jobRun: Pick<AgentJobRunListItem, "trigger" | "scheduleJob"> | null | undefined,
  setupScheduleJob: string,
  fallbackSource?: string | null,
): string {
  if (jobRun?.trigger === "scheduled" || fallbackSource === "cron") return "Scheduled";
  if (jobRun?.trigger === "one_time" && jobRun.scheduleJob === setupScheduleJob) return "Setup validation";
  if (jobRun?.trigger === "one_time" || fallbackSource === "manual") return "One-time";
  return "Manual";
}

export function scheduledWindowRunNote({
  jobRunStatus,
  runSummary,
  runtime,
}: {
  jobRunStatus?: string | null;
  runSummary?: string | null;
  runtime?: string | null;
}): string {
  if (runSummary && jobRunStatus && jobRunStatus !== "Succeeded") return `${jobRunStatus} · ${runSummary}`;
  if (runSummary) return runSummary;
  if (jobRunStatus) return `${jobRunStatus} · ${runtime || "Local Agent"}`;
  return "No run yet";
}
