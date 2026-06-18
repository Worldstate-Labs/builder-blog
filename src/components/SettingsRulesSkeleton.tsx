const settingsRuleSkeletonLabels = ["Source fetching rules", "AI Digest rules"];

export function SettingsRulesSkeleton() {
  return (
    <section className="settings-rules settings-rules-skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading rules</span>
      <div className="settings-rules-skeleton-list">
        {settingsRuleSkeletonLabels.map((label) => (
          <div className="settings-skeleton-rule" key={label}>
            <span className="settings-skeleton-card-label">{label}</span>
            <div className="settings-skeleton-card" />
          </div>
        ))}
      </div>
    </section>
  );
}
