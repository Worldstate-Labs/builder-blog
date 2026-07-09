import { I18nText } from "@/components/I18nProvider";
import { PageHeader } from "@/components/PageHeader";

export default function BuildersLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-pad sources-loading"
    >
      <PageHeader
        title={<I18nText id="workspace.sources" />}
        description={<I18nText id="workspace.sourcesDesc" />}
      />
      <div className="workspace-content-stack workspace-content-stack--tabs-first">
        <section className="sources-tab-surface">
          <div className="workspace-top-tabs-row">
            <div
              aria-label="Sources and AI Brief tabs"
              className="workspace-top-tabs fb-segmented-tabs sources-loading-tabs"
              role="tablist"
            >
             {[
                { id: "tabs.sources" as const, selected: true },
                { id: "tabs.aiDigest" as const, selected: false },
              ].map(({ id, selected }) => (
                <span
                  aria-disabled="true"
                  aria-selected={selected}
                  className="fb-btn sources-loading-tab"
                  key={id}
                  role="tab"
                  tabIndex={-1}
                >
                  <I18nText id={id} />
                </span>
              ))}
            </div>
          </div>

          <section className="sources-tab-body" aria-label="Loading Sources content">
            <section className="sources-section-stack" aria-hidden="true">
              <section className="sources-sync-section sources-sync-panel library-section-panel">
                <div className="library-section-summary library-section-summary--static">
                  <div className="library-section-summary-copy source-section-skeleton-copy">
                    <h2 className="fb-section-heading">Source syncing</h2>
                    <div className="source-section-skeleton-desc" />
                  </div>
                </div>
                <div className="library-section-body">
                  <div className="source-sync-skeleton-panel" />
                </div>
              </section>

              <section className="your-library-section">
                <div className="library-hub-toolbar">
                  <div className="library-hub-toolbar-copy">
                    <h2 className="fb-section-heading">Your source library</h2>
                    <div className="source-sync-skeleton-line" />
                  </div>
                  <div className="source-section-skeleton-chip" />
                </div>
                <section className="your-library-panel library-section-panel">
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

              <section className="imported-libraries-section imported-libraries-panel library-section-panel">
                <div className="imported-libraries-head">
                  <div className="imported-libraries-copy">
                    <h2 className="fb-section-heading">Imported source libraries</h2>
                    <div className="source-sync-skeleton-line" />
                  </div>
                  <div className="source-section-skeleton-chip source-section-skeleton-chip--short" />
                </div>
                <div className="imported-library-stack">
                  <div className="source-sync-skeleton-panel" />
                </div>
              </section>
            </section>
          </section>
        </section>
      </div>
    </div>
  );
}
