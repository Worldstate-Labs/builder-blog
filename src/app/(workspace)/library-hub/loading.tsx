export default function LibraryHubLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-pad hub-loading"
    >
      <h1 className="sr-only">Loading Hub</h1>
      <div className="workspace-content-stack workspace-content-stack--tabs-first">
        <div className="workspace-top-tabs-row">
          <div
            aria-label="Hub tabs"
            className="workspace-top-tabs fb-segmented-tabs hub-loading-tabs"
            role="tablist"
          >
            {["Source libraries", "AI Digest archives"].map((label) => {
              const selected = label === "Source libraries";
              return (
                <span
                  aria-disabled="true"
                  aria-selected={selected ? "true" : "false"}
                  className="fb-btn hub-loading-tab"
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

        <section aria-label="Loading Hub content">
          <div className="library-hub-toolbar">
            <div className="library-hub-toolbar-copy">
              <span className="sr-only">Loading Hub content</span>
              <div className="library-hub-skeleton-line is-title" />
              <div className="library-hub-skeleton-line is-wide" />
            </div>
            <div className="library-hub-skeleton-pill" />
          </div>
          <div className="hub-list-stack fb-hub-list">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="fb-hub-card" key={index}>
                <div className="fb-hub-card-head">
                  <div className="library-hub-skeleton-copy">
                    <div className="library-hub-skeleton-line is-kicker" />
                    <div className="library-hub-skeleton-line is-title" />
                    <div className="library-hub-skeleton-line is-body" />
                  </div>
                  <div className="library-hub-skeleton-chip" />
                </div>
                <div className="library-hub-skeleton-sources">
                  <div className="library-hub-skeleton-row" />
                  <div className="library-hub-skeleton-row" />
                </div>
                <div className="fb-hub-card-stats library-hub-skeleton-stats">
                  <span className="library-hub-skeleton-stat" />
                  <span className="library-hub-skeleton-stat" />
                  <span className="library-hub-skeleton-stat" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
