import { I18nText } from "@/components/I18nProvider";
import { PageHeader } from "@/components/PageHeader";

export default function DashboardLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="page-pad page-pad--reading home-page home-loading"
    >
      <PageHeader
        title={<I18nText id="workspace.today" />}
        description={<I18nText id="workspace.todayDesc" />}
      />
      <section className="workspace-content-stack workspace-content-stack--tabs-first home-workspace">
        <div className="workspace-top-tabs-row">
          <div
            aria-label="Today feed tabs"
            className="workspace-top-tabs fb-segmented-tabs home-loading-tabs"
            role="tablist"
          >
            {[
              { id: "tabs.aiDigest" as const, selected: true },
              { id: "tabs.following" as const, selected: false },
              { id: "tabs.favorites" as const, selected: false },
            ].map(({ id, selected }) => (
              <span
                aria-disabled="true"
                aria-selected={selected}
                className="fb-btn home-loading-tab"
                key={id}
                role="tab"
                tabIndex={-1}
              >
                <I18nText id={id} />
              </span>
            ))}
          </div>
        </div>

        <section className="home-tab-panel" aria-label="Loading Today content">
          <div className="ai-digest-stack home-loading-ai-digest" aria-hidden="true">
            <section className="digest-control-bar home-loading-control">
              {[
                { id: "tabs.aiDigestCollection" as const },
                { id: "tabs.aiDigestIssue" as const },
              ].map(({ id }) => (
                <div className="digest-control-field" key={id}>
                  <span className="digest-control-label"><I18nText id={id} /></span>
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
