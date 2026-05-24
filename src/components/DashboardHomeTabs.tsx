"use client";

import { useEffect, useState, type ReactNode } from "react";

type DashboardTab = "for-you" | "subscription";

export function DashboardHomeTabs({
  forYou,
  initialTab,
  subscription,
}: {
  forYou: ReactNode;
  initialTab: DashboardTab;
  subscription: ReactNode;
}) {
  const [selectedTab, setSelectedTab] = useState<DashboardTab>(initialTab);

  useEffect(() => {
    function syncFromUrl() {
      const params = new URLSearchParams(window.location.search);
      setSelectedTab(params.get("tab") === "subscription" ? "subscription" : "for-you");
    }

    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  function selectTab(tab: DashboardTab) {
    setSelectedTab(tab);
    const url = tab === "subscription" ? "/dashboard?tab=subscription" : "/dashboard";
    window.history.pushState(null, "", url);
  }

  return (
    <>
      <div className="home-tabs" role="tablist" aria-label="Home feed">
        <button
          aria-controls="home-panel-for-you"
          aria-selected={selectedTab === "for-you"}
          data-active={selectedTab === "for-you" ? "true" : undefined}
          id="home-tab-for-you"
          onClick={() => selectTab("for-you")}
          role="tab"
          type="button"
        >
          For You
        </button>
        <button
          aria-controls="home-panel-subscription"
          aria-selected={selectedTab === "subscription"}
          data-active={selectedTab === "subscription" ? "true" : undefined}
          id="home-tab-subscription"
          onClick={() => selectTab("subscription")}
          role="tab"
          type="button"
        >
          Subscription
        </button>
      </div>
      <section
        aria-labelledby="home-tab-for-you"
        hidden={selectedTab !== "for-you"}
        id="home-panel-for-you"
        role="tabpanel"
      >
        {selectedTab === "for-you" ? forYou : null}
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
