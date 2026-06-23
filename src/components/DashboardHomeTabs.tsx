import type { ReactNode } from "react";
import { FeedLoadingState } from "@/components/FeedState";
import { WorkspaceTabShell } from "@/components/WorkspaceTabShell";
import type { WorkspaceTopTabItem } from "@/components/WorkspaceTopTabs";

type DashboardTab = "ai-digest" | "following" | "favorites";

const HOME_TABS: Array<WorkspaceTopTabItem<DashboardTab>> = [
  {
    value: "ai-digest",
    label: "AI Digest",
    href: "/dashboard?tab=ai-digest",
    panelId: "home-panel-ai-digest",
    tabId: "home-tab-ai-digest",
  },
  {
    value: "following",
    label: "Following",
    href: "/dashboard?tab=following",
    panelId: "home-panel-following",
    tabId: "home-tab-following",
  },
  {
    value: "favorites",
    label: "Favorites",
    href: "/dashboard?tab=favorites",
    panelId: "home-panel-favorites",
    tabId: "home-tab-favorites",
  },
];

export function DashboardHomeTabs({
  aiDigest,
  favorites,
  following,
  initialTab,
}: {
  aiDigest: ReactNode;
  favorites: ReactNode;
  following: ReactNode;
  initialTab: DashboardTab;
}) {
  return (
    <WorkspaceTabShell
      ariaLabel="Today feed tabs"
      fallbackByValue={{
        "ai-digest": <HomeAiDigestFallback />,
        favorites: <FeedLoadingState label="Loading Favorites" />,
        following: <FeedLoadingState label="Loading Following" />,
      }}
      fallbackClassName="home-tab-panel"
      items={HOME_TABS}
      selectedValue={initialTab}
    >
      <section
        aria-labelledby="home-tab-ai-digest"
        className="home-tab-panel"
        hidden={initialTab !== "ai-digest"}
        id="home-panel-ai-digest"
        role="tabpanel"
      >
        {initialTab === "ai-digest" ? aiDigest : null}
      </section>
      <section
        aria-labelledby="home-tab-following"
        className="home-tab-panel"
        hidden={initialTab !== "following"}
        id="home-panel-following"
        role="tabpanel"
      >
        {initialTab === "following" ? following : null}
      </section>
      <section
        aria-labelledby="home-tab-favorites"
        className="home-tab-panel"
        hidden={initialTab !== "favorites"}
        id="home-panel-favorites"
        role="tabpanel"
      >
        {initialTab === "favorites" ? favorites : null}
      </section>
    </WorkspaceTabShell>
  );
}

function HomeAiDigestFallback() {
  return (
    <div className="ai-digest-stack home-loading-ai-digest" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading AI Digest</span>
      <section className="digest-control-bar home-loading-control">
        {["AI Digest collection", "AI Digest issue"].map((label) => (
          <div className="digest-control-field" key={label}>
            <span className="digest-control-label">{label}</span>
            <span className="home-loading-control-shell" />
          </div>
        ))}
      </section>
      <div className="ai-digest-panel">
        <div className="ai-digest-body">
          <section className="home-loading-digest-card" aria-hidden="true">
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
  );
}
