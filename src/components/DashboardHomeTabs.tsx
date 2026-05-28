"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode } from "react";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedTab =
    searchParams.get("tab") === null
      ? initialTab
      : parseTab(searchParams.get("tab"));

  function selectTab(tab: DashboardTab) {
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
            { id: "ai-digest", label: "Digest" },
            { id: "subscription", label: "Following" },
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
