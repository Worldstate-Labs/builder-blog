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
};

const policy = timeoutPolicy as TimeoutPolicy;

export function localAgentTimeoutSeconds(intervalMinutes: string | number, job: string): string {
  const jobDefault = policy.jobDefaultSeconds?.[job];
  if (Number.isFinite(jobDefault) && jobDefault > 0) {
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
