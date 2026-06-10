export function AgentTokenPanelSkeleton() {
  return (
    <section className="access-keys-panel" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading authorized access</span>
      <div className="access-keys-head">
        <div className="access-keys-skeleton-copy">
          <div className="settings-skeleton-line settings-skeleton-line--access-title" />
          <div className="settings-skeleton-line settings-skeleton-line--access-desc" />
        </div>
        <div className="settings-skeleton-pill" />
      </div>
      <div className="access-keys-list access-keys-list--skeleton">
        {[0, 1, 2].map((item) => (
          <div className="access-key-card access-key-card--skeleton" key={item}>
            <span className="access-key-skeleton-icon" />
            <span className="access-keys-skeleton-copy">
              <span className="settings-skeleton-line settings-skeleton-line--device-title" />
              <span className="settings-skeleton-line settings-skeleton-line--device-status" />
            </span>
            <span className="settings-skeleton-pill access-key-skeleton-pill" />
          </div>
        ))}
      </div>
    </section>
  );
}
