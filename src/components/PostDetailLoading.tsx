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
      </nav>

      <article className="feed-card fetched-post-card post-detail-card post-detail-loading-card">
        <div className="post-copy">
          <header className="post-detail-head">
            <div className="post-detail-kicker-row">
              <span className="post-detail-loading-source-mark" />
              <span className="post-detail-loading-line post-detail-loading-line--meta" />
              <span className="post-detail-dot" aria-hidden="true">·</span>
              <span className="post-detail-loading-line post-detail-loading-line--meta-short" />
            </div>
            <div className="post-detail-loading-line post-detail-loading-line--title" />
            <div className="post-detail-byline">
              <div className="post-detail-author">
                <span className="post-detail-loading-source-mark post-detail-author-avatar" />
                <span className="post-detail-loading-line post-detail-loading-line--source" />
              </div>
              <div className="post-detail-loading-pill" />
            </div>
          </header>
          <section className="post-detail-summary" aria-hidden="true">
            <div className="post-detail-loading-line post-detail-loading-line--label" />
            <div className="post-detail-loading-line post-detail-loading-line--summary" />
            <div className="post-detail-loading-line post-detail-loading-line--summary" />
            <div className="post-detail-loading-line post-detail-loading-line--summary-short" />
          </section>
          <section className="post-detail-raw" aria-hidden="true">
            <div className="post-detail-raw-head">
              <div className="post-detail-raw-copy">
                <div className="post-detail-loading-line post-detail-loading-line--summary" />
                <div className="post-detail-loading-line post-detail-loading-line--summary-short" />
              </div>
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}
