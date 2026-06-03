"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, CSSProperties } from "react";
import { Archive, Home, LibraryBig, Search, Settings, UsersRound } from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: "home" | "archive" | "builders" | "hub" | "search" | "settings";
};

const icons: Record<AppNavItem["icon"], ComponentType<{ className?: string }>> = {
  home: Home,
  archive: Archive,
  builders: UsersRound,
  hub: LibraryBig,
  search: Search,
  settings: Settings,
};

export function AppNav({
  desktopLayout = "rail",
  items,
  mobileItems,
  mode = "both",
}: {
  desktopLayout?: "bar" | "rail";
  items: AppNavItem[];
  mobileItems?: AppNavItem[];
  mode?: "desktop" | "mobile" | "both";
}) {
  const pathname = usePathname();
  const mobileNavItems = mobileItems ?? items;
  const desktopClassName =
    desktopLayout === "bar"
      ? "fb-nav-list fb-nav-list-bar"
      : "fb-nav-list fb-nav-list-rail";

  return (
    <>
      {mode !== "mobile" ? (
        <nav className={desktopClassName} aria-label="Primary">
          {items.map((item) => {
            const Icon = icons[item.icon];
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                className={`fb-nav${active ? " active" : ""}`}
                data-active={active ? "true" : undefined}
                href={item.href}
                key={item.href}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}
      {mode !== "desktop" ? (
        <nav
          className="fb-m-tabbar"
          style={{ "--tab-count": mobileNavItems.length } as CSSProperties}
          aria-label="Primary"
        >
          {mobileNavItems.map((item) => {
            const Icon = icons[item.icon];
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                className={`fb-m-tab${active ? " active" : ""}`}
                data-active={active ? "true" : undefined}
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}
    </>
  );
}
