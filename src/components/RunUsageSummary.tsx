import { formatUsageCost, formatUsageTokens, type UsageSummary } from "@/lib/usage-summary";

export function RunUsageSummary({ usage }: { usage: UsageSummary | null }) {
  if (!usage) return null;

  return (
    <section aria-label="Task usage" className="sync-panel-usage-summary">
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
      <div className="sync-panel-usage-summary-item">
        <span>Cost</span>
        <strong>{formatUsageCost(usage)}</strong>
      </div>
    </section>
  );
}
