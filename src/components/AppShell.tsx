import Link from "next/link";
import type { Session } from "next-auth";
import { Bell, Settings } from "lucide-react";
import { AppNav, type AppNavItem } from "@/components/AppNav";
import { BrandMark } from "@/components/BrandMark";
import { SearchForm } from "@/components/SearchForm";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { isAdminEmail } from "@/lib/admin";

const desktopNav: AppNavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/builders", label: "Sources", icon: "builders" },
  { href: "/library-hub", label: "Hub", icon: "hub" },
];

const mobileNav: AppNavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/builders", label: "Sources", icon: "builders" },
  { href: "/library-hub", label: "Hub", icon: "hub" },
  { href: "/search", label: "Search", icon: "search" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function AppShell({
  children,
  session,
}: {
  children: React.ReactNode;
  session?: Session | null;
}) {
  const isAdmin = isAdminEmail(session?.user?.email);

  return (
    <div className="app-frame min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="fb-top hidden lg:flex">
        <Link href="/dashboard" className="fb-brand">
          <BrandMark />
          <span className="fb-brand-name">FollowBrief</span>
        </Link>
        <div className="hidden flex-1 min-w-0 md:block">
          <SearchForm query="" variant="header" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <UserMenu compact isAdmin={isAdmin} session={session} />
        </div>
      </header>

      <header className="fb-m-top lg:hidden">
        <Link href="/dashboard" className="fb-brand">
          <BrandMark />
          <span className="fb-brand-name">FollowBrief</span>
        </Link>
        <span className="grow" />
        <ThemeToggle />
        <Link
          href="/dashboard"
          className="fb-m-icon"
          aria-label="Notifications"
        >
          <Bell aria-hidden="true" />
        </Link>
        <UserMenu compact isAdmin={isAdmin} session={session} />
      </header>

      <div className="app-body">
        <aside className="fb-side hidden lg:flex">
          <AppNav items={desktopNav} mode="desktop" />
          <div className="mt-auto pt-3.5 border-t border-[var(--line)]">
            <Link href="/settings" className="fb-nav">
              <Settings aria-hidden="true" />
              <span>Settings</span>
            </Link>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {children}
          <AppNav items={desktopNav} mobileItems={mobileNav} mode="mobile" />
        </main>
      </div>
    </div>
  );
}
