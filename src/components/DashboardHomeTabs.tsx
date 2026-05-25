"use client";

import { useEffect, useState, type ReactNode } from "react";

type DashboardTab = "ai-dijest" | "subscription" | "for-you";

export function DashboardHomeTabs({
  aiDijest,
  forYou,
  initialTab,
  subscription,
}: {
  aiDijest: ReactNode;
  forYou: ReactNode;
  initialTab: DashboardTab;
  subscription: ReactNode;
}) {
  const [selectedTab, setSelectedTab] = useState<DashboardTab>(initialTab);

  useEffect(() => {
    function syncFromUrl() {
      const params = new URLSearchParams(window.location.search);
      setSelectedTab(parseTab(params.get("tab")));
    }

    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  function selectTab(tab: DashboardTab) {
    setSelectedTab(tab);
    const url = tab === "ai-dijest" ? "/dashboard" : `/dashboard?tab=${tab}`;
    window.history.pushState(null, "", url);
  }

  return (
    <>
      <div className="hidden lg:block">
        <div className="fb-tabs" role="tablist" aria-label="Home feed">
          <button
            aria-controls="home-panel-ai-dijest"
            aria-selected={selectedTab === "ai-dijest"}
            className={`fb-tab${selectedTab === "ai-dijest" ? " active" : ""}`}
            data-active={selectedTab === "ai-dijest" ? "true" : undefined}
            id="home-tab-ai-dijest"
            onClick={() => selectTab("ai-dijest")}
            role="tab"
            type="button"
          >
            AI dijest
          </button>
          <button
            aria-controls="home-panel-for-you"
            aria-selected={selectedTab === "for-you"}
            className={`fb-tab${selectedTab === "for-you" ? " active" : ""}`}
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
            className={`fb-tab${selectedTab === "subscription" ? " active" : ""}`}
            data-active={selectedTab === "subscription" ? "true" : undefined}
            id="home-tab-subscription"
            onClick={() => selectTab("subscription")}
            role="tab"
            type="button"
          >
            Subscription
          </button>
        </div>
      </div>
      <div className="fb-m-segctl lg:hidden" role="tablist" aria-label="Home feed">
        {(
          [
            { id: "ai-dijest", label: "AI dijest" },
            { id: "for-you", label: "For You" },
            { id: "subscription", label: "Subscription" },
          ] as const
        ).map((tab) => (
          <button
            aria-selected={selectedTab === tab.id}
            className={`fb-m-seg${selectedTab === tab.id ? " active" : ""}`}
            data-active={selectedTab === tab.id ? "true" : undefined}
            key={tab.id}
            onClick={() => selectTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <section
        aria-labelledby="home-tab-ai-dijest"
        hidden={selectedTab !== "ai-dijest"}
        id="home-panel-ai-dijest"
        role="tabpanel"
      >
        {selectedTab === "ai-dijest" ? aiDijest : null}
      </section>
      <section
        aria-labelledby="home-tab-subscription"
        hidden={selectedTab !== "subscription"}
        id="home-panel-subscription"
        role="tabpanel"
      >
        {selectedTab === "subscription" ? subscription : null}
      </section>
      <section
        aria-labelledby="home-tab-for-you"
        hidden={selectedTab !== "for-you"}
        id="home-panel-for-you"
        role="tabpanel"
      >
        {selectedTab === "for-you" ? forYou : null}
      </section>
    </>
  );
}

function parseTab(value: string | null): DashboardTab {
  if (value === "subscription" || value === "for-you") return value;
  return "ai-dijest";
}
