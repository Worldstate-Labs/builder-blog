import type { ReactNode } from "react";
import { WorkspaceTabShell } from "@/components/WorkspaceTabShell";
import type { WorkspaceTopTabItem } from "@/components/WorkspaceTopTabsView";

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
  return (
    <WorkspaceTabShell
      ariaLabel={ariaLabel}
      fallbackByValue={{
        digest: digestFallback,
        fetch: fetchFallback,
      }}
      fallbackClassNameByValue={{
        digest: "sources-tab-body sources-tab-body--digest",
        fetch: "sources-tab-body sources-tab-body--fetch",
      }}
      items={items}
      selectedValue={selectedTab}
    >
      {children}
    </WorkspaceTabShell>
  );
}
