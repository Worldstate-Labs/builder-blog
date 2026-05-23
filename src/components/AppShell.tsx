import Link from "next/link";
import type { Session } from "next-auth";
import { LogOut, Settings } from "lucide-react";
import { AppNav, type AppNavItem } from "@/components/AppNav";
import { isAdminEmail } from "@/lib/admin";

const nav: AppNavItem[] = [
  { href: "/dashboard", label: "Digest", icon: "home" },
  { href: "/history", label: "History", icon: "archive" },
  { href: "/recommendations", label: "For You", icon: "recommendations" },
  { href: "/builders", label: "Builders", icon: "builders" },
  { href: "/library-hub", label: "Hub", icon: "hub" },
  { href: "/search", label: "Search", icon: "search" },
];

export function AppShell({
  children,
  session,
}: {
  children: React.ReactNode;
  session?: Session | null;
}) {
  const items = isAdminEmail(session?.user?.email)
    ? [...nav, { href: "/admin", label: "Admin", icon: "admin" as const }]
    : nav;

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl">
        <aside className="shell-sidebar hidden w-[17rem] shrink-0 border-r border-[var(--line)] px-5 py-6 lg:flex lg:flex-col">
          <Link href="/dashboard" className="group flex items-center gap-3">
            <span className="brand-mark">BB</span>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                Builder Blog
              </div>
              <div className="mt-1 text-xl font-semibold leading-tight">
                Signal desk
              </div>
            </div>
          </Link>
          <AppNav items={items} mode="desktop" />
          <div className="sidebar-note mt-auto">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
              Agent loop
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
              Keep the pool current, subscribe the useful builders, then sync the digest back here.
            </p>
          </div>
          <UserMenu session={session} />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="mobile-header lg:hidden">
            <div className="flex items-center justify-between gap-4">
              <Link
                className="text-base font-semibold"
                href="/dashboard"
              >
                Builder Blog
              </Link>
              <UserMenu session={session} compact />
            </div>
          </header>
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
