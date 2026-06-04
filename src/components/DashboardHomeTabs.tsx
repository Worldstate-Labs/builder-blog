"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

type DashboardTab = "ai-digest" | "favorites" | "subscription";

const HOME_TABS: Array<{ id: DashboardTab; label: string; panelId: string; tabId: string }> = [
  {
    id: "ai-digest",
    label: "Digest",
    panelId: "home-panel-ai-digest",
    tabId: "home-tab-ai-digest",
  },
  {
    id: "favorites",
    label: "Favorites",
    panelId: "home-panel-favorites",
    tabId: "home-tab-favorites",
  },
  {
    id: "subscription",
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
      <div className="home-feed-tabs-row">
        <div className="fb-segmented-tabs home-feed-tabs" role="tablist" aria-label="Home feed">
          {HOME_TABS.map((tab) => (
            <button
              aria-controls={tab.panelId}
              aria-selected={selectedTab === tab.id}
              className="fb-btn compact"
              data-active={selectedTab === tab.id ? "true" : undefined}
              id={tab.tabId}
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <section
        aria-labelledby="home-tab-ai-digest"
        hidden={selectedTab !== "ai-digest"}
        id="home-panel-ai-digest"
        role="tabpanel"
      >
        {selectedTab === "ai-digest" ? aiDigest : null}
      </section>
      <section
        aria-labelledby="home-tab-favorites"
        hidden={selectedTab !== "favorites"}
        id="home-panel-favorites"
        role="tabpanel"
      >
        {selectedTab === "favorites" ? favorites : null}
      </section>
      <section
        aria-labelledby="home-tab-subscription"
        hidden={selectedTab !== "subscription"}
        id="home-panel-subscription"
        role="tabpanel"
      >
        {selectedTab === "subscription" ? subscription : null}
      </section>
    </>
  );
}
