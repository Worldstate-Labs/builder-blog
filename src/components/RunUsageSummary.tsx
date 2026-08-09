import { formatUsageCost, formatUsageTokens, type UsageSummary } from "@/lib/usage-summary";

export function RunUsageSummary({
  showCost = false,
  usage,
}: {
  showCost?: boolean;
  usage: UsageSummary | null;
}) {
  if (!usage) return null;

  return (
    <section
      aria-label="Task usage"
      className={showCost ? "sync-panel-usage-summary" : "sync-panel-usage-summary is-cost-hidden"}
    >
      <div className="sync-panel-usage-summary-item">
        <span>Tokens</span>
        <strong>{formatUsageTokens(usage.totalTokens)}</strong>
      </div>
      <div className="sync-panel-usage-summary-item">
        <span>Input</span>
        <strong>{formatUsageTokens(usage.inputTokens)}</strong>
      </div>
      <div className="sync-panel-usage-summary-item">
        <span>Output</span>
        <strong>{formatUsageTokens(usage.outputTokens)}</strong>
      </div>
      {showCost ? (
        <div className="sync-panel-usage-summary-item">
          <span>Cost</span>
          <strong>{formatUsageCost(usage)}</strong>
        </div>
      ) : null}
    </section>
  );
}
