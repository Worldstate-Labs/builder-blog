import type { ReactNode } from "react";
import { WorkspaceTopTabs, type WorkspaceTopTabItem } from "@/components/WorkspaceTopTabs";

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
    <>
      <WorkspaceTopTabs
        ariaLabel="Home feed tabs"
        items={HOME_TABS}
        selectedValue={initialTab}
      />
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
    </>
  );
}
