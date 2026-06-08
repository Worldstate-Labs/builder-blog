"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentType, CSSProperties } from "react";
import { Home, LibraryBig, UsersRound } from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: "home" | "builders" | "hub";
};

const icons: Record<AppNavItem["icon"], ComponentType<{ className?: string }>> = {
  home: Home,
  builders: UsersRound,
  hub: LibraryBig,
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
  const searchParams = useSearchParams();
  const returnTo = normalizeLegacyReturnTo(
    pathname.startsWith("/posts/") ? searchParams.get("returnTo") ?? "" : "",
  );
  const mobileNavItems = mobileItems ?? items;
  const desktopClassName =
    desktopLayout === "bar"
      ? "fb-nav-list fb-nav-list-bar"
      : "fb-nav-list fb-nav-list-rail";
  const desktopAriaLabel =
    desktopLayout === "bar" ? "Primary" : "Desktop primary";

  return (
    <>
      {mode !== "mobile" ? (
        <nav className={desktopClassName} aria-label={desktopAriaLabel}>
          {items.map((item) => {
            const Icon = icons[item.icon];
            const active = isActiveNavItem(pathname, item, returnTo);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`fb-nav${active ? " active" : ""}`}
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
      {mode !== "desktop" ? (
        <nav
          className="fb-m-tabbar"
          style={{ "--tab-count": mobileNavItems.length } as CSSProperties}
          aria-label="Mobile primary"
        >
          {mobileNavItems.map((item) => {
            const Icon = icons[item.icon];
            const active = isActiveNavItem(pathname, item, returnTo);
            return (
              <Link
                aria-current={active ? "page" : undefined}
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

function isActiveNavItem(pathname: string, item: AppNavItem, returnTo = "") {
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  if (pathname.startsWith("/posts/")) {
    if (item.href === "/dashboard" && returnTo.startsWith("/dashboard")) {
      return true;
    }
    if (
      item.href === "/builders" &&
      (returnTo.startsWith("/builders") || returnTo.startsWith("/builder/"))
    ) {
      return true;
    }
    if (item.href === "/library-hub" && returnTo.startsWith("/library-hub")) return true;
  }
  if (item.href === "/builders") return pathname.startsWith("/builder/");
  return false;
}

function normalizeLegacyReturnTo(value: string) {
  if (value.startsWith("/recommendations")) return "/dashboard?tab=following";
  if (value.startsWith("/history")) return "/dashboard?tab=ai-digest";
  return value;
}
