import Link from "next/link";
import type { Session } from "next-auth";
import { LogOut } from "lucide-react";
import { AppNav, type AppNavItem } from "@/components/AppNav";
import { isAdminEmail } from "@/lib/admin";

const nav: AppNavItem[] = [
  { href: "/dashboard", label: "Today", icon: "home" },
  { href: "/history", label: "History", icon: "archive" },
  { href: "/builders", label: "Builders", icon: "builders" },
  { href: "/library-hub", label: "Hub", icon: "hub" },
  { href: "/search", label: "Search", icon: "search" },
  { href: "/settings", label: "Agent", icon: "key" },
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
          <div className="mt-4 border-t border-[var(--line)] pt-5 text-sm text-[var(--muted)]">
            <p className="truncate" title={session?.user?.email ?? undefined}>
              {session?.user?.email}
            </p>
            <Link
              className="mt-3 inline-flex min-h-10 items-center gap-2 font-medium text-[var(--ink)] underline"
              href="/api/auth/signout"
              prefetch={false}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Link>
          </div>
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
              <span className="max-w-[58vw] truncate text-right text-xs text-[var(--muted)]">
                {session?.user?.email}
              </span>
              <Link
                aria-label="Sign out"
                className="button-light button-compact"
                href="/api/auth/signout"
                prefetch={false}
              >
                <LogOut className="h-4 w-4" />
              </Link>
            </div>
          </header>
          {children}
          <AppNav items={items} mode="mobile" />
        </main>
      </div>
    </div>
  );
}
