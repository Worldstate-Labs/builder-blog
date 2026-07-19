export const DEFAULT_CLOUD_SHARD_BUDGET_POLICY = {
  minimumSeconds: 3_600,
  standardMaximumSeconds: 7_200,
  longMediaMaximumSeconds: 14_400,
  safetyMultiplier: 1.5,
  completionAllowanceSeconds: 600,
  roundingSeconds: 300,
  progressHeartbeatSeconds: 60,
};

function nonNegativeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return fallback;
  return Math.floor(numericValue);
}

function positiveInteger(value, fallback) {
  const normalized = nonNegativeInteger(value, fallback);
  return normalized > 0 ? normalized : fallback;
}

function positiveNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

function validDate(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function roundUpToIncrement(value, increment) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(increment) || increment <= 0) return Math.ceil(value);
  return Math.ceil(value / increment) * increment;
}

export function normalizeCloudShardBudgetPolicy(configured = {}) {
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
    safetyMultiplier: positiveNumber(
      configured.safetyMultiplier,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.safetyMultiplier,
    ),
    completionAllowanceSeconds: nonNegativeInteger(
      configured.completionAllowanceSeconds,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.completionAllowanceSeconds,
    ),
    roundingSeconds: positiveInteger(
      configured.roundingSeconds,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.roundingSeconds,
    ),
    progressHeartbeatSeconds: nonNegativeInteger(
      configured.progressHeartbeatSeconds,
      DEFAULT_CLOUD_SHARD_BUDGET_POLICY.progressHeartbeatSeconds,
    ),
  };
}

export function resolveCloudShardWorkloadClass(input = {}) {
  if (input.workloadClass === "standard" || input.workloadClass === "long_media") {
    return input.workloadClass;
  }
  const sourceType = String(input.sourceType ?? "").trim().toLowerCase();
  if (sourceType === "podcast" || sourceType === "youtube" || sourceType === "video") {
    return "long_media";
  }
  return "standard";
}

export function cloudShardExecutionBudget(input = {}, policy = DEFAULT_CLOUD_SHARD_BUDGET_POLICY) {
  const normalizedPolicy = normalizeCloudShardBudgetPolicy(policy);
  const estimatedWorkSeconds = nonNegativeInteger(input.estimatedWorkSeconds, 0);
  const workloadClass = resolveCloudShardWorkloadClass(input);
  const rawBudgetSeconds =
    estimatedWorkSeconds * normalizedPolicy.safetyMultiplier + normalizedPolicy.completionAllowanceSeconds;
  const roundedBudgetSeconds = roundUpToIncrement(rawBudgetSeconds, normalizedPolicy.roundingSeconds);
  const minimumAppliedBudgetSeconds = Math.max(
    estimatedWorkSeconds,
    normalizedPolicy.minimumSeconds,
    roundedBudgetSeconds,
  );
  const maximumSeconds =
    workloadClass === "long_media"
      ? normalizedPolicy.longMediaMaximumSeconds
      : normalizedPolicy.standardMaximumSeconds;
  const executionBudgetSeconds = Math.min(maximumSeconds, minimumAppliedBudgetSeconds);
  let budgetReason = "scaled_and_rounded";
  if (executionBudgetSeconds === normalizedPolicy.minimumSeconds && executionBudgetSeconds > roundedBudgetSeconds) {
    budgetReason = "minimum_budget";
  } else if (executionBudgetSeconds === normalizedPolicy.standardMaximumSeconds && workloadClass === "standard") {
    budgetReason = "capped_standard_maximum";
  } else if (
    executionBudgetSeconds === normalizedPolicy.longMediaMaximumSeconds &&
    workloadClass === "long_media"
  ) {
    budgetReason = "capped_long_media_maximum";
  }

  return {
    estimatedWorkSeconds,
    executionBudgetSeconds,
    workloadClass,
    budgetReason,
  };
}

export function cloudDeadlineState(input = {}, policy = DEFAULT_CLOUD_SHARD_BUDGET_POLICY) {
  const now = validDate(input.now);
  const mustSucceedBy = validDate(input.mustSucceedBy);
  if (!now || !mustSucceedBy) return "on_time";
  if (now.getTime() > mustSucceedBy.getTime()) return "missed";

  const normalizedPolicy = normalizeCloudShardBudgetPolicy(policy);
  const executionBudgetSeconds = nonNegativeInteger(input.executionBudgetSeconds, 0);
  const projectedCompletionAt =
    now.getTime() + (executionBudgetSeconds + normalizedPolicy.progressHeartbeatSeconds) * 1000;
  return projectedCompletionAt > mustSucceedBy.getTime() ? "at_risk" : "on_time";
}
