import { PageHeader } from "@/components/PageHeader";

export default function SearchLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-pad page-pad--reading search-page search-loading"
    >
      <PageHeader
        title="Search"
        description="Find sources, posts, and AI Digest issues."
      />

      <div className="workspace-content-stack search-results-workspace">
        <section className="search-hero-form" aria-label="Loading search controls">
          <div className="search-form search-loading-form">
            <div className="search-form-row">
              <div className="search-query-label">
                <span className="search-loading-input" />
              </div>
              <span className="search-loading-pill" />
              <span className="search-loading-pill" />
              <span className="search-loading-pill search-loading-pill--wide" />
              <span className="search-loading-button" />
            </div>
          </div>
        </section>

        <section
          aria-label="Loading search results"
          className="search-results-shell"
        >
          <nav
            aria-label="Search result type filter"
            className="fb-segmented-tabs filter-tabs search-loading-tabs"
            role="tablist"
          >
            {[
              { label: "All", selected: true },
              { label: "Sources", selected: false },
              { label: "Posts", selected: false },
              { label: "AI Digest", selected: false },
            ].map(({ label, selected }) => (
              <span
                aria-disabled="true"
                aria-selected={selected}
                className="fb-btn compact search-loading-tab"
                key={label}
                role="tab"
                tabIndex={-1}
              >
                {label}
              </span>
            ))}
          </nav>
          <div className="search-meta-row" role="status">
            <span className="sr-only">Loading search results</span>
            <span aria-hidden="true" className="search-meta-skeleton search-meta-skeleton--count" />
            <span aria-hidden="true" className="search-meta-skeleton search-meta-skeleton--page" />
          </div>
          <div className="search-results-list">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="search-result-skeleton" key={index} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
