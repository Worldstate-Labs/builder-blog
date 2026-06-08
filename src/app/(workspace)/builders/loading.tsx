export default function BuildersLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-pad sources-loading"
    >
      <h1 className="sr-only">Loading Sources</h1>
      <div className="workspace-content-stack">
        <section className="sources-tab-surface">
          <div className="workspace-top-tabs-row">
            <div
              aria-label="Sources and AI Digest tabs"
              className="workspace-top-tabs fb-segmented-tabs sources-loading-tabs"
            >
              <span className="fb-btn sources-loading-tab is-active">Sources</span>
              <span className="fb-btn sources-loading-tab">AI Digest</span>
            </div>
          </div>

          <section className="sources-tab-body sources-tab-body--fetch">
            <section className="sources-section-stack">
              <section className="your-library-panel fb-panel">
                <div className="source-sync-skeleton-line" />
                <div className="source-sync-skeleton-panel" />
                <div className="library-section-panel">
                  <div className="library-section-summary">
                    <div className="library-section-summary-copy source-section-skeleton-copy">
                      <div className="source-section-skeleton-title" />
                      <div className="source-section-skeleton-desc" />
                    </div>
                    <div className="library-section-meta">
                      <div className="source-section-skeleton-chip source-section-skeleton-chip--short" />
                      <div className="source-section-skeleton-chip" />
                    </div>
                  </div>
                  <div className="library-section-body">
                    <div className="source-section-skeleton-row" />
                    <div className="source-section-skeleton-card" />
                  </div>
                </div>
              </section>
            </section>
          </section>
        </section>
      </div>
    </div>
  );
}
