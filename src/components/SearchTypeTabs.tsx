"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [, startTransition] = useTransition();
  const activeValue = props.items.find((item) => item.active)?.value ?? props.items[0]?.value ?? "";
  const [pending, setPending] = useState<{ from: string; value: string } | null>(null);

  const pendingValue =
    pending?.from === activeValue && pending.value !== activeValue
      ? pending.value
      : null;
  const visualValue = pendingValue ?? activeValue;
  const items = useMemo(
    () =>
      props.items.map((item) => ({
        ...item,
        active: item.value === visualValue,
      })),
    [props.items, visualValue],
  );

  function selectTab(value: string) {
    if (value === activeValue) {
      setPending(null);
      return;
    }
    const target = props.items.find((item) => item.value === value);
    if (!target) return;
    setPending({ from: activeValue, value });
    startTransition(() => {
      router.push(target.href);
    });
  }

  return (
    <SearchTypeTabsView
      {...props}
      items={items}
      linkComponent={NextLink}
      onSelect={selectTab}
    />
  );
}
