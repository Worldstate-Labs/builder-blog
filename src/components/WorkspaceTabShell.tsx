"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  WorkspaceTopTabsView,
  type WorkspaceTopTabItem,
} from "@/components/WorkspaceTopTabsView";

type WorkspaceTabShellProps<TValue extends string> = {
  ariaLabel: string;
  children: ReactNode;
  fallbackByValue: Record<TValue, ReactNode>;
  fallbackClassName?: string;
  fallbackClassNameByValue?: Partial<Record<TValue, string>>;
  items: Array<WorkspaceTopTabItem<TValue>>;
  selectedValue: TValue;
};

export function WorkspaceTabShell<TValue extends string>({
  ariaLabel,
  children,
  fallbackByValue,
  fallbackClassName,
  fallbackClassNameByValue,
  items,
  selectedValue,
}: WorkspaceTabShellProps<TValue>) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState<{ from: TValue; value: TValue } | null>(null);

  const pendingValue =
    pending?.from === selectedValue && pending.value !== selectedValue
      ? pending.value
      : null;
  const visualValue = pendingValue ?? selectedValue;
  const visualItem = items.find((item) => item.value === visualValue) ?? items[0]!;
  const isPendingNewTab = pendingValue !== null;

  function selectTab(value: TValue) {
    if (value === selectedValue) {
      setPending(null);
      return;
    }
    const target = items.find((item) => item.value === value);
    if (!target?.href) return;
    setPending({ from: selectedValue, value });
    startTransition(() => {
      router.push(target.href!);
    });
  }

  const resolvedFallbackClassName =
    fallbackClassNameByValue?.[visualValue] ?? fallbackClassName;

  return (
    <>
      <WorkspaceTopTabsView
        ariaLabel={ariaLabel}
        items={items}
        onSelect={selectTab}
        selectedValue={visualValue}
      />
      {isPendingNewTab ? (
        <section
          aria-labelledby={visualItem.tabId}
          className={resolvedFallbackClassName}
          id={visualItem.panelId}
          role="tabpanel"
        >
          {fallbackByValue[visualValue]}
        </section>
      ) : (
        children
      )}
    </>
  );
}
