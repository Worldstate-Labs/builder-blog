"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { WorkspaceTopTabs, type WorkspaceTopTabItem } from "@/components/WorkspaceTopTabs";

type DashboardTab = "ai-digest" | "favorites" | "following";

const HOME_TABS: Array<WorkspaceTopTabItem<DashboardTab>> = [
  {
    value: "ai-digest",
    label: "AI Digest",
    panelId: "home-panel-ai-digest",
    tabId: "home-tab-ai-digest",
  },
  {
    value: "following",
    label: "Following",
    panelId: "home-panel-following",
    tabId: "home-tab-following",
  },
  {
    value: "favorites",
    label: "Favorites",
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
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState(initialTab);

  function selectTab(tab: DashboardTab) {
    setSelectedTab(tab);
    const url = tab === "ai-digest" ? "/dashboard" : `/dashboard?tab=${tab}`;
    router.replace(url, { scroll: false });
  }

  return (
    <>
      <WorkspaceTopTabs
        ariaLabel="Home feed"
        items={HOME_TABS}
        onSelect={selectTab}
        selectedValue={selectedTab}
      />
      <section
        aria-labelledby="home-tab-ai-digest"
        className="home-tab-panel"
        hidden={selectedTab !== "ai-digest"}
        id="home-panel-ai-digest"
        role="tabpanel"
      >
        {selectedTab === "ai-digest" ? aiDigest : null}
      </section>
      <section
        aria-labelledby="home-tab-following"
        className="home-tab-panel"
        hidden={selectedTab !== "following"}
        id="home-panel-following"
        role="tabpanel"
      >
        {selectedTab === "following" ? following : null}
      </section>
      <section
        aria-labelledby="home-tab-favorites"
        className="home-tab-panel"
        hidden={selectedTab !== "favorites"}
        id="home-panel-favorites"
        role="tabpanel"
      >
        {selectedTab === "favorites" ? favorites : null}
      </section>
    </>
  );
}
