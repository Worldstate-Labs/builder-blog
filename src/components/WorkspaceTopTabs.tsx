"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type WorkspaceTopTabItem<TValue extends string = string> = {
  value: TValue;
  label: ReactNode;
  href?: string;
  panelId?: string;
  tabId?: string;
};

type WorkspaceTopTabsProps<TValue extends string = string> = {
  ariaLabel: string;
  items: Array<WorkspaceTopTabItem<TValue>>;
  onSelect?: (value: TValue) => void;
  selectedValue: TValue;
};

export function WorkspaceTopTabs<TValue extends string>({
  ariaLabel,
  items,
  onSelect,
  selectedValue,
}: WorkspaceTopTabsProps<TValue>) {
  return (
    <div className="workspace-top-tabs-row">
      <nav className="fb-segmented-tabs workspace-top-tabs" role="tablist" aria-label={ariaLabel}>
        {items.map((item) => {
          const selected = selectedValue === item.value;
          const commonProps = {
            "aria-controls": item.panelId,
            "aria-selected": selected,
            className: "fb-btn compact",
            "data-active": selected ? "true" : undefined,
            id: item.tabId,
            role: "tab",
          } as const;

          if (onSelect) {
            return (
              <button
                {...commonProps}
                key={item.value}
                onClick={() => onSelect(item.value)}
                type="button"
              >
                {item.label}
              </button>
            );
          }

          return (
            <Link {...commonProps} href={item.href ?? "#"} key={item.value}>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
