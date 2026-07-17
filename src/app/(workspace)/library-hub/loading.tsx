import { I18nText } from "@/components/I18nProvider";
import { PageHeader } from "@/components/PageHeader";

export default function LibraryHubLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="page-pad hub-loading">
      <PageHeader
        title={<I18nText id="workspace.hub" />}
        description={<I18nText id="workspace.hubDesc" />}
      />
      <div className="workspace-content-stack">
        <section aria-label="Loading source libraries">
          <span className="sr-only">Loading source libraries</span>
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
