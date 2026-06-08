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
          <div className="feed-content-stack home-loading-content" aria-hidden="true">
            <div className="feed-skeleton-list">
              {[0, 1, 2].map((index) => (
                <div className="feed-skeleton-card" key={index} />
              ))}
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
