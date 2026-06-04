"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { WorkspaceTopTabs, type WorkspaceTopTabItem } from "@/components/WorkspaceTopTabs";

type DashboardTab = "ai-digest" | "favorites" | "subscription";

const HOME_TABS: Array<WorkspaceTopTabItem<DashboardTab>> = [
  {
    value: "ai-digest",
    label: "Digest",
    panelId: "home-panel-ai-digest",
    tabId: "home-tab-ai-digest",
  },
  {
    value: "favorites",
    label: "Favorites",
    panelId: "home-panel-favorites",
    tabId: "home-tab-favorites",
  },
  {
    value: "subscription",
    label: "Following",
    panelId: "home-panel-subscription",
    tabId: "home-tab-subscription",
  },
];

export function DashboardHomeTabs({
  aiDigest,
  favorites,
  initialTab,
  subscription,
}: {
  aiDigest: ReactNode;
  favorites: ReactNode;
  initialTab: DashboardTab;
  subscription: ReactNode;
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
        aria-labelledby="home-tab-favorites"
        className="home-tab-panel"
        hidden={selectedTab !== "favorites"}
        id="home-panel-favorites"
        role="tabpanel"
      >
        {selectedTab === "favorites" ? favorites : null}
      </section>
      <section
        aria-labelledby="home-tab-subscription"
        className="home-tab-panel"
        hidden={selectedTab !== "subscription"}
        id="home-panel-subscription"
        role="tabpanel"
      >
        {selectedTab === "subscription" ? subscription : null}
      </section>
    </>
  );
}
