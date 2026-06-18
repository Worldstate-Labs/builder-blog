import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export function BuilderDetailLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-pad page-pad--reading builder-detail-page builder-detail-loading"
    >
      <PageHeader
        className="builder-detail-page-head"
        title="Loading source"
      >
        <div className="builder-detail-head-stack">
          <span className="fb-breadcrumb-link builder-detail-breadcrumb builder-detail-loading-breadcrumb">
            <ChevronLeft aria-hidden="true" />
            Sources
          </span>
          <div className="builder-detail-identity">
            <span className="builder-detail-avatar builder-detail-loading-avatar" />
            <div className="builder-detail-title-stack">
              <div className="builder-detail-title-row">
                <span className="builder-detail-loading-title" />
                <span className="builder-detail-loading-badge" />
              </div>
              <div className="fb-src-meta builder-detail-meta-row">
                <span className="builder-detail-meta-group">
                  <span className="builder-detail-loading-meta" />
                  <span className="source-count-dot source-meta-dot">·</span>
                  <span className="builder-detail-loading-meta builder-detail-loading-meta--short" />
                  <span className="source-latest-dot source-meta-dot">·</span>
                  <span className="builder-detail-loading-meta builder-detail-loading-meta--wide" />
                </span>
              </div>
              <div className="builder-detail-control-row">
                <div className="builder-detail-actions-skeleton">
                  <span className="sr-only">Loading source follow action</span>
                  <div className="builder-detail-action-skeleton-button" />
                </div>
                <span className="builder-detail-loading-chip" />
              </div>
              <span className="builder-detail-loading-bio" />
            </div>
          </div>
        </div>
      </PageHeader>

      <div className="workspace-content-stack builder-detail-workspace">
        <section className="builder-detail-section">
          <h2 className="fb-section-title">Recent posts</h2>
          <ul className="recent-post-list recent-post-list--skeleton">
            <li className="sr-only">Loading recent posts</li>
            {[0, 1, 2].map((index) => (
              <li key={index} className="recent-post-skeleton-card fb-panel">
                <div className="recent-post-skeleton-line recent-post-skeleton-line--meta" />
                <div className="recent-post-skeleton-line recent-post-skeleton-line--title" />
                <div className="recent-post-skeleton-line" />
                <div className="recent-post-skeleton-line recent-post-skeleton-line--short" />
              </li>
            ))}
          </ul>
        </section>

        <details className="builder-detail-section builder-detail-channels">
          <summary className="builder-detail-channels-summary">
            <span className="builder-detail-channels-summary-copy">
              <span>Source libraries</span>
              <span className="builder-detail-channels-summary-desc">
                Source libraries that include this source.
              </span>
            </span>
            <span className="builder-detail-loading-chip" />
          </summary>
          <div className="builder-detail-channel-list">
            <span className="sr-only">Loading source libraries</span>
            {[0, 1].map((index) => (
              <div key={index} className="builder-detail-channel-row">
                <div className="builder-detail-channel-copy">
                  <div className="recent-post-skeleton-line recent-post-skeleton-line--meta" />
                  <div className="recent-post-skeleton-line recent-post-skeleton-line--short" />
                </div>
                <div className="recent-post-skeleton-line recent-post-skeleton-line--meta" />
                <div className="builder-detail-action-skeleton-button" />
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
