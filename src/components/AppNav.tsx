"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import { postReturnToFromPath } from "@/lib/navigation";
import {
  AppNavView,
  type AppNavItem,
  type AppNavLinkProps,
  type AppNavViewItem,
} from "@/components/AppNavView";

export type { AppNavItem } from "@/components/AppNavView";

// Container: reads the current route to compute each item's active state and
// injects Next's Link. All presentation lives in AppNavView (dependency-free,
// design-system ready). Call sites (AppShell) use AppNav unchanged.
function NextLink({ href, children, ...rest }: AppNavLinkProps) {
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

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
  const { t } = useI18n();
  const returnTo = postReturnToFromPath(pathname, searchParams.get("returnTo"));

  const withActive = (list: AppNavItem[]): AppNavViewItem[] =>
    list.map((item) => ({
      ...item,
      label: navLabel(item.icon, t),
      active: isActiveNavItem(pathname, item, returnTo),
    }));

  return (
    <AppNavView
      desktopLayout={desktopLayout}
      desktopAriaLabel={desktopLayout === "bar" ? t("nav.primary") : t("nav.desktopPrimary")}
      items={withActive(items)}
      mobileAriaLabel={t("nav.mobilePrimary")}
      mobileItems={mobileItems ? withActive(mobileItems) : undefined}
      mode={mode}
      linkComponent={NextLink}
    />
  );
}

function navLabel(icon: AppNavItem["icon"], t: ReturnType<typeof useI18n>["t"]) {
  if (icon === "home") return t("nav.home");
  if (icon === "sources") return t("nav.sources");
  return t("nav.hub");
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
