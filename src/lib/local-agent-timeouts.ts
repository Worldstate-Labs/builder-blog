import timeoutPolicy from "../../config/local-agent-timeouts.json";
import {
  cloudDeadlineState as sharedCloudDeadlineState,
  cloudShardExecutionBudget as sharedCloudShardExecutionBudget,
  normalizeCloudShardBudgetPolicy,
} from "../../scripts/cloud-shard-budget.mjs";

type TimeoutPolicy = {
  defaultIntervalMinutes: number;
  baseMultiplierSecondsPerMinute: number;
  minSeconds: number;
  defaultMaxSeconds: number;
  jobDefaultSeconds?: Record<string, number>;
  jobMaxSeconds: Record<string, number>;
  shardFraction: {
    numerator: number;
    denominator: number;
  };
  cloudShardBudget?: {
    minimumSeconds?: number;
    standardMaximumSeconds?: number;
    longMediaMaximumSeconds?: number;
    safetyMultiplier?: number;
    completionAllowanceSeconds?: number;
    roundingSeconds?: number;
    progressHeartbeatSeconds?: number;
  };
};

export type CloudShardWorkloadClass = "standard" | "long_media";
export type CloudDeadlineState = "on_time" | "at_risk" | "missed";
export type CloudShardBudgetReason =
  | "minimum_budget"
  | "scaled_and_rounded"
  | "capped_standard_maximum"
  | "capped_long_media_maximum";

export type CloudShardExecutionBudgetInput = {
  estimatedWorkSeconds?: string | number | null | undefined;
  sourceType?: string | null;
  workloadClass?: CloudShardWorkloadClass | null;
};

export type CloudDeadlineStateInput = {
  now: Date | string | number;
  mustSucceedBy: Date | string | number | null | undefined;
  executionBudgetSeconds: string | number | null | undefined;
};

const policy = timeoutPolicy as TimeoutPolicy;
function cloudShardBudgetPolicy() {
  return normalizeCloudShardBudgetPolicy(policy.cloudShardBudget ?? {});
}

export function localAgentTimeoutSeconds(intervalMinutes: string | number, job: string): string {
  const jobDefault = policy.jobDefaultSeconds?.[job];
  if (typeof jobDefault === "number" && Number.isFinite(jobDefault) && jobDefault > 0) {
    return String(jobDefault);
  }
  const interval = Number(intervalMinutes);
  const safeInterval =
    Number.isFinite(interval) && interval > 0
      ? interval
      : policy.defaultIntervalMinutes;
  const base = safeInterval * policy.baseMultiplierSecondsPerMinute;
  const max = policy.jobMaxSeconds[job] ?? policy.defaultMaxSeconds;
  return String(Math.min(max, Math.max(policy.minSeconds, base)));
}

export function localAgentShardTimeoutSeconds(jobTimeoutSeconds: string | number): string {
  const timeout = Number(jobTimeoutSeconds);
  const safeTimeout =
    Number.isFinite(timeout) && timeout > 0
      ? timeout
      : Number(localAgentTimeoutSeconds(policy.defaultIntervalMinutes, "default"));
  return String(Math.floor((safeTimeout * policy.shardFraction.numerator) / policy.shardFraction.denominator));
}

export function cloudShardExecutionBudget(input: CloudShardExecutionBudgetInput) {
  return sharedCloudShardExecutionBudget(input, cloudShardBudgetPolicy()) as {
    estimatedWorkSeconds: number;
    executionBudgetSeconds: number;
    workloadClass: CloudShardWorkloadClass;
    budgetReason: CloudShardBudgetReason;
  };
}

export function cloudDeadlineState(input: CloudDeadlineStateInput): CloudDeadlineState {
  return sharedCloudDeadlineState(input, cloudShardBudgetPolicy()) as CloudDeadlineState;
}
