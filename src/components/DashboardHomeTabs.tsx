"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

type DashboardTab = "ai-digest" | "favorites" | "subscription";

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
            Digest
          </button>
          <button
            aria-controls="home-panel-favorites"
            aria-selected={selectedTab === "favorites"}
            className={`fb-tab${selectedTab === "favorites" ? " active" : ""}`}
            data-active={selectedTab === "favorites" ? "true" : undefined}
            id="home-tab-favorites"
            onClick={() => selectTab("favorites")}
            role="tab"
            type="button"
          >
            Favorites
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
            Following
          </button>
        </div>
      </div>
      <div className="fb-m-segctl at-mobile" role="tablist" aria-label="Home feed">
        {(
          [
            { id: "ai-digest", label: "Digest" },
            { id: "favorites", label: "Favorites" },
            { id: "subscription", label: "Following" },
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
