"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  WorkspaceTopTabsView,
  type WorkspaceTopTabItem,
} from "@/components/WorkspaceTopTabsView";

export type SourcesTabValue = "fetch" | "digest";

type SourcesTabShellProps = {
  ariaLabel: string;
  children: ReactNode;
  digestFallback: ReactNode;
  fetchFallback: ReactNode;
  items: Array<WorkspaceTopTabItem<SourcesTabValue>>;
  selectedTab: SourcesTabValue;
};

export function SourcesTabShell({
  ariaLabel,
  children,
  digestFallback,
  fetchFallback,
  items,
  selectedTab,
}: SourcesTabShellProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pendingTab, setPendingTab] = useState<SourcesTabValue | null>(null);
  const visualTab = pendingTab ?? selectedTab;
  const visualItem = items.find((item) => item.value === visualTab) ?? items[0]!;

  function selectTab(value: SourcesTabValue) {
    if (value === selectedTab) {
      setPendingTab(null);
      return;
    }
    const target = items.find((item) => item.value === value);
    if (!target?.href) return;
    setPendingTab(value);
    startTransition(() => {
      router.push(target.href!);
    });
  }

  const fallback =
    visualTab === "fetch" ? fetchFallback : digestFallback;

  return (
    <>
      <WorkspaceTopTabsView
        ariaLabel={ariaLabel}
        items={items}
        onSelect={selectTab}
        selectedValue={visualTab}
      />
      {pendingTab && pendingTab !== selectedTab ? (
        <section
          aria-labelledby={visualItem.tabId}
          className={`sources-tab-body sources-tab-body--${visualTab}`}
          id={visualItem.panelId}
          role="tabpanel"
        >
          {fallback}
        </section>
      ) : (
        children
      )}
    </>
  );
}
