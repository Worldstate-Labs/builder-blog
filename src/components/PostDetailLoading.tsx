import { ChevronLeft } from "lucide-react";

export function PostDetailLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-pad page-pad--reading reading-page post-detail-loading"
    >
      <span className="sr-only">Loading post</span>
      <nav aria-label="Post navigation" className="reading-page-toolbar">
        <span className="fb-breadcrumb-link post-detail-loading-back">
          <ChevronLeft aria-hidden="true" />
          <span className="post-detail-loading-line post-detail-loading-line--back" />
        </span>
        <span className="reading-source-label post-detail-loading-source">
          <span className="post-detail-loading-source-mark" />
          <span className="post-detail-loading-line post-detail-loading-line--source" />
        </span>
      </nav>

      <article className="feed-card fetched-post-card post-detail-card post-detail-loading-card">
        <div className="post-copy">
          <div className="post-detail-loading-line post-detail-loading-line--title" />
          <div className="post-meta post-detail-loading-meta">
            <span className="post-detail-loading-source-mark" />
            <span className="post-detail-loading-line post-detail-loading-line--meta" />
            <span className="post-detail-loading-line post-detail-loading-line--meta-short" />
          </div>
          <section className="post-detail-summary" aria-hidden="true">
            <div className="post-detail-loading-line post-detail-loading-line--label" />
            <div className="post-detail-loading-line post-detail-loading-line--summary" />
            <div className="post-detail-loading-line post-detail-loading-line--summary" />
            <div className="post-detail-loading-line post-detail-loading-line--summary-short" />
          </section>
          <section className="post-detail-raw" aria-hidden="true">
            <div className="post-detail-raw-head">
              <div className="post-detail-raw-copy">
                <div className="post-detail-loading-line post-detail-loading-line--label" />
                <div className="post-detail-loading-line post-detail-loading-line--raw-desc" />
              </div>
              <div className="post-detail-loading-pill" />
            </div>
          </section>
          <div className="post-footer" aria-hidden="true">
            <div className="post-detail-loading-line post-detail-loading-line--published" />
            <div className="post-detail-loading-pill" />
          </div>
        </div>
      </article>
    </div>
  );
}
