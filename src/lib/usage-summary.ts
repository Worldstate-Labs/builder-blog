export type UsageSummary = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  costEstimated: boolean;
  currency: string | null;
  provider: string | null;
  model: string | null;
  source: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[$,\s]/g, "");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function intValue(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed === null ? null : Math.max(0, Math.round(parsed));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  }
  return false;
}

function readUsageFromRecord(value: Record<string, unknown>): UsageSummary | null {
  const usage = record(value.usage) ?? record(value.tokenUsage) ?? record(value.token_usage) ?? value;
  const inputTokens = intValue(
    usage.inputTokens ?? usage.input_tokens ?? usage.input ?? usage.promptTokens ?? usage.prompt_tokens,
  );
  const outputTokens = intValue(
    usage.outputTokens ?? usage.output_tokens ?? usage.output ?? usage.completionTokens ?? usage.completion_tokens,
  );
  const cachedInputTokens = intValue(
    usage.cachedInputTokens ??
      usage.cached_input_tokens ??
      usage.cacheReadInputTokens ??
      usage.cache_read_input_tokens ??
      usage.cacheRead ??
      usage.cache_read ??
      usage.cacheReadTokens ??
      usage.cache_read_tokens,
  );
  const reasoningTokens = intValue(usage.reasoningTokens ?? usage.reasoning_tokens);
  const explicitTotal = intValue(usage.totalTokens ?? usage.total_tokens ?? usage.total);
  const totalTokens = explicitTotal ?? (
    inputTokens !== null || outputTokens !== null || cachedInputTokens !== null || reasoningTokens !== null
      ? (inputTokens ?? cachedInputTokens ?? 0) + (outputTokens ?? 0) + (reasoningTokens ?? 0)
      : null
  );
  const costUsd = numberValue(
    usage.costUsd ?? usage.cost_usd ?? usage.totalCostUsd ?? usage.total_cost_usd ?? usage.totalCost ?? usage.total_cost,
  );
  const costEstimated = booleanValue(
    usage.costEstimated ?? usage.cost_estimated ?? usage.estimatedCost ?? usage.estimated_cost,
  );
  const currency = stringValue(usage.currency) ?? (costUsd !== null ? "USD" : null);
  const provider = stringValue(usage.provider);
  const model = stringValue(usage.model);
  const source = stringValue(usage.source);

  if (
    inputTokens === null &&
    outputTokens === null &&
    cachedInputTokens === null &&
    reasoningTokens === null &&
    totalTokens === null &&
    costUsd === null
  ) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    totalTokens,
    costUsd,
    costEstimated,
    currency,
    provider,
    model,
    source,
  };
}

export function readUsageSummary(...values: unknown[]): UsageSummary | null {
  for (const value of values) {
    const parsed = record(value);
    if (!parsed) continue;
    const usage = readUsageFromRecord(parsed);
    if (usage) return usage;
  }
  return null;
}

export function formatUsageTokens(value: number | null): string {
  return value === null ? "Not reported" : new Intl.NumberFormat("en-US").format(value);
}

export function formatUsageCost(usage: UsageSummary): string {
  if (usage.costUsd === null) return "Not reported";
  const currency = usage.currency || "USD";
  try {
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: usage.costUsd < 1 ? 4 : 2,
    }).format(usage.costUsd);
    return usage.costEstimated ? `est. ${formatted}` : formatted;
  } catch {
    const formatted = `$${usage.costUsd.toFixed(usage.costUsd < 1 ? 4 : 2)}`;
    return usage.costEstimated ? `est. ${formatted}` : formatted;
  }
}
