"use client";

import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Home, LibraryBig, Rss } from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: "home" | "sources" | "hub";
};

/** AppNavItem with its active state precomputed by the container. */
export type AppNavViewItem = AppNavItem & { active: boolean };

const icons: Record<AppNavItem["icon"], ComponentType<{ className?: string }>> = {
  home: Home,
  sources: Rss,
  hub: LibraryBig,
};

export type AppNavLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  "aria-current"?: "page" | undefined;
  "data-active"?: "true" | undefined;
};

export type AppNavLinkComponent = ComponentType<AppNavLinkProps>;

// Dependency-free default. The AppNav wrapper injects next/link to keep
// client-side navigation; Storybook / design-sync render with this anchor.
function DefaultLink({ href, children, ...rest }: AppNavLinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

export type AppNavViewProps = {
  desktopLayout?: "bar" | "rail";
  items: AppNavViewItem[];
  mobileItems?: AppNavViewItem[];
  mode?: "desktop" | "mobile" | "both";
  linkComponent?: AppNavLinkComponent;
  desktopAriaLabel?: string;
  mobileAriaLabel?: string;
};

export function AppNavView({
  desktopLayout = "rail",
  items,
  mobileItems,
  mode = "both",
  linkComponent: LinkComponent = DefaultLink,
  desktopAriaLabel,
  mobileAriaLabel = "Mobile primary",
}: AppNavViewProps) {
  const mobileNavItems = mobileItems ?? items;
  const desktopClassName =
    desktopLayout === "bar"
      ? "fb-nav-list fb-nav-list-bar"
      : "fb-nav-list fb-nav-list-rail";
  const resolvedDesktopAriaLabel =
    desktopAriaLabel ?? (desktopLayout === "bar" ? "Primary" : "Desktop primary");

  return (
    <>
      {mode !== "mobile" ? (
        <nav className={desktopClassName} aria-label={resolvedDesktopAriaLabel}>
          {items.map((item) => {
            const Icon = icons[item.icon];
            return (
              <LinkComponent
                aria-current={item.active ? "page" : undefined}
                className={`fb-nav${item.active ? " active" : ""}`}
                data-active={item.active ? "true" : undefined}
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </LinkComponent>
            );
          })}
        </nav>
      ) : null}
      {mode !== "desktop" ? (
        <nav
          className="fb-m-tabbar"
          style={{ "--tab-count": mobileNavItems.length } as CSSProperties}
          aria-label={mobileAriaLabel}
        >
          {mobileNavItems.map((item) => {
            const Icon = icons[item.icon];
            return (
              <LinkComponent
                aria-current={item.active ? "page" : undefined}
                className={`fb-m-tab${item.active ? " active" : ""}`}
                data-active={item.active ? "true" : undefined}
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </LinkComponent>
            );
          })}
        </nav>
      ) : null}
    </>
  );
}
