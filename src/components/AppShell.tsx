import Link from "next/link";
import type { Session } from "next-auth";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { AppNav, type AppNavItem } from "@/components/AppNav";
import { BrandMark } from "@/components/BrandMark";
import { SearchForm } from "@/components/SearchForm";
import { isAdminEmail } from "@/lib/admin";

const nav: AppNavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/builders", label: "Sources", icon: "builders" },
  { href: "/library-hub", label: "Hub", icon: "hub" },
];

export function AppShell({
  children,
  session,
}: {
  children: React.ReactNode;
  session?: Session | null;
}) {
  const items = nav;

  return (
    <div className="app-frame min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="app-topbar">
        <div className="app-topbar-left">
          <Link href="/dashboard" className="app-brand group">
            <BrandMark />
            <div className="min-w-0">
              <div className="text-base font-semibold leading-tight text-[var(--ink)]">
                FollowBrief
              </div>
            </div>
          </Link>
          <SearchForm query="" variant="header" />
        </div>
        <UserMenu session={session} compact />
      </header>
      <div className="app-body">
        <aside className="shell-sidebar hidden w-[12rem] shrink-0 border-r border-[var(--line)] px-4 py-6 lg:flex lg:flex-col">
          <AppNav items={items} mode="desktop" />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {children}
          <AppNav items={items} mode="mobile" />
        </main>
      </div>
    </div>
  );
}

function UserMenu({
  compact = false,
  session,
}: {
  compact?: boolean;
  session?: Session | null;
}) {
  const user = session?.user;
  const name = user?.name || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const initial = name.trim().charAt(0).toUpperCase() || "U";
  const isAdmin = isAdminEmail(email);

  return (
    <details className={`user-menu ${compact ? "user-menu-compact" : ""}`}>
      <summary aria-label="Open user menu" className="user-menu-trigger">
        {user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="user-avatar" src={user.image} />
        ) : (
          <span className="user-avatar" aria-hidden="true">
            {initial}
          </span>
        )}
        {!compact ? (
          <span className="user-menu-copy">
            <span className="user-menu-name">{name}</span>
            <span className="user-menu-email" title={email}>
              {email}
            </span>
          </span>
        ) : null}
      </summary>
      <div className="user-menu-popover">
        {email ? (
          <p className="user-menu-popover-email" title={email}>
            {email}
          </p>
        ) : null}
        {isAdmin ? (
          <span className="user-menu-item user-menu-item-static">
            <ShieldCheck className="h-4 w-4" />
            Admin
          </span>
        ) : null}
        <Link className="user-menu-item" href="/settings">
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        <div className="user-menu-separator" />
        <Link
          className="user-menu-item"
          href="/api/auth/signout"
          prefetch={false}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Link>
      </div>
    </details>
  );
}
