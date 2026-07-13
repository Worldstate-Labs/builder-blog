export function SettingsRulesSkeleton({
  showDigestRules = false,
}: {
  showDigestRules?: boolean;
}) {
  const labels = showDigestRules
    ? ["Source fetching rules", "AI Brief rules"]
    : ["Source fetching rules"];
  return (
    <section className="settings-rules settings-rules-skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading rules</span>
      <div className="settings-rules-skeleton-list">
        {labels.map((label) => (
          <div className="settings-skeleton-rule" key={label}>
            <span className="settings-skeleton-card-label">{label}</span>
            <div className="settings-skeleton-card" />
          </div>
        ))}
      </div>
    </section>
  );
}
