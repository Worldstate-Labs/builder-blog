export default function DashboardLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-pad page-pad--reading home-page home-loading"
    >
      <h1 className="sr-only">Loading Home</h1>
      <section className="workspace-content-stack workspace-content-stack--tabs-first home-workspace">
        <div className="workspace-top-tabs-row">
          <div
            aria-label="Home feed tabs"
            className="workspace-top-tabs fb-segmented-tabs home-loading-tabs"
            role="tablist"
          >
            {["AI Digest", "Following", "Favorites"].map((label) => (
              <span
                aria-disabled="true"
                aria-selected="false"
                className="fb-btn home-loading-tab"
                key={label}
                role="tab"
                tabIndex={-1}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        <section className="home-tab-panel" aria-label="Loading Home content">
          <div className="ai-digest-stack home-loading-ai-digest" aria-hidden="true">
            <section className="digest-control-bar home-loading-control">
              {["AI Digest archive source", "AI Digest archive"].map((label) => (
                <div className="digest-control-field" key={label}>
                  <span className="digest-control-label">{label}</span>
                  <span className="home-loading-control-shell" />
                </div>
              ))}
            </section>
            <div className="ai-digest-panel">
              <div className="ai-digest-body">
                <section className="home-loading-digest-card">
                  <span className="home-loading-line home-loading-line--kicker" />
                  <span className="home-loading-line home-loading-line--title" />
                  <span className="home-loading-line" />
                  <span className="home-loading-line home-loading-line--short" />
                  <div className="home-loading-post-list">
                    {[0, 1, 2].map((index) => (
                      <span className="home-loading-post-row" key={index} />
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
