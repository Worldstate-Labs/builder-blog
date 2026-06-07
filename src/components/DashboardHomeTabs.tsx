import type { ReactNode } from "react";
import { WorkspaceTopTabs, type WorkspaceTopTabItem } from "@/components/WorkspaceTopTabs";

type DashboardTab = "ai-digest" | "following";

const HOME_TABS: Array<WorkspaceTopTabItem<DashboardTab>> = [
  {
    value: "ai-digest",
    label: "AI Digest",
    href: "/dashboard",
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
];

export function DashboardHomeTabs({
  aiDigest,
  following,
  initialTab,
}: {
  aiDigest: ReactNode;
  following: ReactNode;
  initialTab: DashboardTab;
}) {
  return (
    <>
      <WorkspaceTopTabs
        ariaLabel="Home sections"
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
    </>
  );
}
