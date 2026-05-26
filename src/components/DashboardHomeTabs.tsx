"use client";

import { useEffect, useState, type ReactNode } from "react";

type DashboardTab = "ai-digest" | "subscription" | "for-you";

export function DashboardHomeTabs({
  aiDigest,
  forYou,
  initialTab,
  subscription,
}: {
  aiDigest: ReactNode;
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
    const url = tab === "ai-digest" ? "/dashboard" : `/dashboard?tab=${tab}`;
    window.history.pushState(null, "", url);
  }

  return (
    <>
      <div className="at-desktop">
        <div className="fb-tabs" role="tablist" aria-label="Home feed">
          <button
            aria-controls="home-panel-ai-digest"
            aria-selected={selectedTab === "ai-digest"}
            className={`fb-tab${selectedTab === "ai-digest" ? " active" : ""}`}
            data-active={selectedTab === "ai-digest" ? "true" : undefined}
            id="home-tab-ai-digest"
            onClick={() => selectTab("ai-digest")}
            role="tab"
            type="button"
          >
            AI digest
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
        </div>
      </div>
      <div className="fb-m-segctl at-mobile" role="tablist" aria-label="Home feed">
        {(
          [
            { id: "ai-digest", label: "AI digest" },
            { id: "subscription", label: "Subscription" },
            { id: "for-you", label: "For You" },
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
        aria-labelledby="home-tab-ai-digest"
        hidden={selectedTab !== "ai-digest"}
        id="home-panel-ai-digest"
        role="tabpanel"
      >
        {selectedTab === "ai-digest" ? aiDigest : null}
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
  return "ai-digest";
}
