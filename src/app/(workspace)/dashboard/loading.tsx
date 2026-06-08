export default function DashboardLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-pad page-pad--reading home-page home-loading"
    >
      <h1 className="sr-only">Loading Home</h1>
      <section className="workspace-content-stack home-workspace">
        <div className="workspace-top-tabs-row">
          <div
            aria-label="Home feed tabs"
            className="workspace-top-tabs fb-segmented-tabs home-loading-tabs"
          >
            <span className="fb-btn home-loading-tab is-active">AI Digest</span>
            <span className="fb-btn home-loading-tab">Following</span>
          </div>
        </div>

        <section className="home-tab-panel">
          <div className="ai-digest-stack">
            <section
              aria-label="Loading AI Digest selection"
              className="digest-control-bar home-loading-control"
            >
              <div className="digest-control-field">
                <span className="digest-control-label">AI Digest</span>
                <span className="home-loading-field" />
              </div>
              <div className="digest-control-field">
                <span className="digest-control-label">AI Digest archive</span>
                <span className="home-loading-field" />
              </div>
            </section>

            <section className="ai-digest-panel">
              <div className="ai-digest-body">
                <div className="home-loading-digest-card">
                  <span className="home-loading-line is-kicker" />
                  <span className="home-loading-line is-title" />
                  <span className="home-loading-line" />
                  <span className="home-loading-line is-short" />
                </div>
                <div className="home-loading-post-list">
                  {[0, 1, 2].map((index) => (
                    <span className="home-loading-post-row" key={index} />
                  ))}
                </div>
              </div>
            </section>
          </div>
        </section>
      </section>
    </div>
  );
}
