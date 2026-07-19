import timeoutPolicy from "../../config/local-agent-timeouts.json";

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
const DEFAULT_CLOUD_SHARD_BUDGET_POLICY = {
  minimumSeconds: 3_600,
  standardMaximumSeconds: 7_200,
  longMediaMaximumSeconds: 14_400,
  safetyMultiplier: 1.5,
  completionAllowanceSeconds: 600,
  roundingSeconds: 300,
  progressHeartbeatSeconds: 60,
} as const;

function cloudShardBudgetPolicy() {
  const configured = policy.cloudShardBudget ?? {};
  return {
    minimumSeconds: positiveInteger(configured.minimumSeconds, DEFAULT_CLOUD_SHARD_BUDGET_POLICY.minimumSeconds),
    standardMaximumSeconds: positiveInteger(
      configured.standardMaximumSeconds,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.standardMaximumSeconds,
    ),
    longMediaMaximumSeconds: positiveInteger(
      configured.longMediaMaximumSeconds,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.longMediaMaximumSeconds,
    ),
    safetyMultiplier: positiveNumber(configured.safetyMultiplier, DEFAULT_CLOUD_SHARD_BUDGET_POLICY.safetyMultiplier),
    completionAllowanceSeconds: nonNegativeInteger(
      configured.completionAllowanceSeconds,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.completionAllowanceSeconds,
    ),
    roundingSeconds: positiveInteger(configured.roundingSeconds, DEFAULT_CLOUD_SHARD_BUDGET_POLICY.roundingSeconds),
    progressHeartbeatSeconds: nonNegativeInteger(
      configured.progressHeartbeatSeconds,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.progressHeartbeatSeconds,
    ),
  };
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
  const budgetPolicy = cloudShardBudgetPolicy();
  const estimatedWorkSeconds = nonNegativeInteger(input.estimatedWorkSeconds, 0);
  const workloadClass = resolveCloudShardWorkloadClass(input);
  const rawBudgetSeconds =
    estimatedWorkSeconds * budgetPolicy.safetyMultiplier + budgetPolicy.completionAllowanceSeconds;
  const roundedBudgetSeconds = roundUpToIncrement(rawBudgetSeconds, budgetPolicy.roundingSeconds);
  const minimumAppliedBudgetSeconds = Math.max(
    estimatedWorkSeconds,
    budgetPolicy.minimumSeconds,
    roundedBudgetSeconds,
  );
  const maximumSeconds =
    workloadClass === "long_media"
      ? budgetPolicy.longMediaMaximumSeconds
      : budgetPolicy.standardMaximumSeconds;
  const executionBudgetSeconds = Math.min(maximumSeconds, minimumAppliedBudgetSeconds);
  let budgetReason: CloudShardBudgetReason = "scaled_and_rounded";
  if (executionBudgetSeconds === budgetPolicy.minimumSeconds && executionBudgetSeconds > roundedBudgetSeconds) {
    budgetReason = "minimum_budget";
  } else if (executionBudgetSeconds === budgetPolicy.standardMaximumSeconds && workloadClass === "standard") {
    budgetReason = "capped_standard_maximum";
  } else if (executionBudgetSeconds === budgetPolicy.longMediaMaximumSeconds && workloadClass === "long_media") {
    budgetReason = "capped_long_media_maximum";
  }

  return {
    estimatedWorkSeconds,
    executionBudgetSeconds,
    workloadClass,
    budgetReason,
  };
}

export function cloudDeadlineState(input: CloudDeadlineStateInput): CloudDeadlineState {
  const now = validDate(input.now);
  const mustSucceedBy = validDate(input.mustSucceedBy);
  if (!now || !mustSucceedBy) return "on_time";
  if (now.getTime() > mustSucceedBy.getTime()) return "missed";

  const budgetPolicy = cloudShardBudgetPolicy();
  const executionBudgetSeconds = nonNegativeInteger(input.executionBudgetSeconds, 0);
  const projectedCompletionAt =
    now.getTime() + (executionBudgetSeconds + budgetPolicy.progressHeartbeatSeconds) * 1000;
  return projectedCompletionAt > mustSucceedBy.getTime() ? "at_risk" : "on_time";
}

function resolveCloudShardWorkloadClass(input: CloudShardExecutionBudgetInput): CloudShardWorkloadClass {
  if (input.workloadClass === "standard" || input.workloadClass === "long_media") {
    return input.workloadClass;
  }
  const sourceType = String(input.sourceType ?? "").trim().toLowerCase();
  if (sourceType === "podcast" || sourceType === "youtube" || sourceType === "video") {
    return "long_media";
  }
  return "standard";
}

function nonNegativeInteger(value: unknown, fallback: number) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return fallback;
  return Math.floor(numericValue);
}

function positiveInteger(value: unknown, fallback: number) {
  const normalized = nonNegativeInteger(value, fallback);
  return normalized > 0 ? normalized : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

function roundUpToIncrement(value: number, increment: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(increment) || increment <= 0) return Math.ceil(value);
  return Math.ceil(value / increment) * increment;
}

function validDate(value: Date | string | number | null | undefined) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
