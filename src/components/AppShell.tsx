import Link from "next/link";
import { getServerSession } from "next-auth";
import { AppNav, type AppNavItem } from "@/components/AppNav";
import { isAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";

const nav: AppNavItem[] = [
  { href: "/dashboard", label: "Today", icon: "home" },
  { href: "/history", label: "History", icon: "archive" },
  { href: "/builders", label: "Builders", icon: "builders" },
  { href: "/search", label: "Search", icon: "search" },
  { href: "/settings", label: "Agent", icon: "key" },
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const items = isAdminEmail(session?.user?.email)
    ? [...nav, { href: "/admin", label: "Admin", icon: "admin" as const }]
    : nav;

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl">
        <aside className="hidden w-64 shrink-0 border-r border-[var(--line)] bg-[var(--rail)] px-5 py-6 lg:flex lg:flex-col">
          <Link href="/dashboard" className="group block" prefetch={false}>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
              Builder Blog
            </div>
            <div className="mt-2 text-xl font-semibold leading-tight">
              Signal over noise
            </div>
          </Link>
          <AppNav items={items} mode="desktop" />
          <div className="mt-auto border-t border-[var(--line)] pt-5 text-sm text-[var(--muted)]">
            <p className="truncate">{session?.user?.email}</p>
            <Link
              className="mt-3 inline-flex min-h-10 items-center font-medium text-[var(--ink)] underline"
              href="/api/auth/signout"
              prefetch={false}
            >
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
                prefetch={false}
              >
                Builder Blog
              </Link>
              <span className="max-w-[58vw] truncate text-right text-xs text-[var(--muted)]">
                {session?.user?.email}
              </span>
            </div>
          </header>
          {children}
          <AppNav items={items} mode="mobile" />
        </main>
      </div>
    </div>
  );
}
