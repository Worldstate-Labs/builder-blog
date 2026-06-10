export default function BuildersLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-pad sources-loading"
    >
      <h1 className="sr-only">Loading Sources</h1>
      <div className="workspace-content-stack workspace-content-stack--tabs-first">
        <section className="sources-tab-surface">
          <div className="workspace-top-tabs-row">
            <div
              aria-label="Sources and AI Digest tabs"
              className="workspace-top-tabs fb-segmented-tabs sources-loading-tabs"
              role="tablist"
            >
              {["Sources", "AI Digest"].map((label) => {
                const selected = label === "Sources";
                return (
                  <span
                    aria-disabled="true"
                    aria-selected={selected ? "true" : "false"}
                    className="fb-btn sources-loading-tab"
                    data-active={selected ? "true" : undefined}
                    key={label}
                    role="tab"
                    tabIndex={-1}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>

          <section className="sources-tab-body" aria-label="Loading Sources content">
            <section className="sources-section-stack" aria-hidden="true">
              <div className="source-sync-skeleton-panel" />
              <div className="source-sync-skeleton-panel" />
            </section>
          </section>
        </section>
      </div>
    </div>
  );
}
