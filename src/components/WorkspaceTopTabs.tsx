"use client";

import Link from "next/link";
import {
  WorkspaceTopTabsView,
  type WorkspaceTopTabLinkProps,
  type WorkspaceTopTabsViewProps,
} from "@/components/WorkspaceTopTabsView";

export type { WorkspaceTopTabItem } from "@/components/WorkspaceTopTabsView";

// Container: injects Next's Link so the tabs keep client-side navigation. All
// presentation lives in WorkspaceTopTabsView (dependency-free, design-system ready).
function NextLink({ href, children, ...rest }: WorkspaceTopTabLinkProps) {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

export function WorkspaceTopTabs<TValue extends string>(
  props: Omit<WorkspaceTopTabsViewProps<TValue>, "linkComponent">,
) {
  return <WorkspaceTopTabsView {...props} linkComponent={NextLink} />;
}
