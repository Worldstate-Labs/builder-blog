"use client";

import Link from "next/link";
import {
  SearchTypeTabsView,
  type SearchTypeTabLinkProps,
  type SearchTypeTabsViewProps,
} from "@/components/SearchTypeTabsView";

export type { SearchTypeTabItem } from "@/components/SearchTypeTabsView";

// Container: injects Next's Link so the tabs keep client-side navigation. All
// presentation lives in SearchTypeTabsView (dependency-free, design-system ready).
function NextLink({ href, children, ...rest }: SearchTypeTabLinkProps) {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

export function SearchTypeTabs(props: Omit<SearchTypeTabsViewProps, "linkComponent">) {
  return <SearchTypeTabsView {...props} linkComponent={NextLink} />;
}
