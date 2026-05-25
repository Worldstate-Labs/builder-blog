"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, CSSProperties } from "react";
import { Archive, Home, LibraryBig, UsersRound } from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: "home" | "archive" | "builders" | "hub";
};

const icons: Record<AppNavItem["icon"], ComponentType<{ className?: string }>> = {
  home: Home,
  archive: Archive,
  builders: UsersRound,
  hub: LibraryBig,
};

export function AppNav({
  items,
  mode = "both",
}: {
  items: AppNavItem[];
  mode?: "desktop" | "mobile" | "both";
}) {
  const pathname = usePathname();

  return (
    <>
      {mode !== "mobile" ? (
        <nav className="hidden flex-col gap-1 lg:flex" aria-label="Primary">
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
          className="mobile-tabbar lg:hidden"
          style={{ "--tab-count": items.length } as CSSProperties}
          aria-label="Primary"
        >
          {items.map((item) => {
            const Icon = icons[item.icon];
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                className="mobile-tab"
                data-active={active ? "true" : undefined}
                href={item.href}
                key={item.href}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}
    </>
  );
}
