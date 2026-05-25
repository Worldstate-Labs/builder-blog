import Image from "next/image";
import Link from "next/link";
import type { Session } from "next-auth";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { AppNav, type AppNavItem } from "@/components/AppNav";
import { BrandMark } from "@/components/BrandMark";
import { SearchForm } from "@/components/SearchForm";
import { ThemeToggle } from "@/components/ThemeToggle";
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
  return (
    <div className="app-frame min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="fb-top">
        <Link href="/dashboard" className="fb-brand">
          <BrandMark />
          <span className="fb-brand-name">FollowBrief</span>
        </Link>
        <div className="hidden flex-1 min-w-0 md:block">
          <SearchForm query="" variant="header" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <UserMenu session={session} compact />
        </div>
      </header>
      <div className="app-body">
        <aside className="fb-side hidden lg:flex">
          <AppNav items={nav} mode="desktop" />
          <div className="mt-auto pt-3.5 border-t border-[var(--line)]">
            <Link href="/settings" className="fb-nav">
              <Settings aria-hidden="true" />
              <span>Settings</span>
            </Link>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {children}
          <AppNav items={nav} mode="mobile" />
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
      <summary
        aria-label={email ? `Account menu for ${email}` : `Account menu for ${name}`}
        className="user-menu-trigger"
      >
        {user?.image ? (
          <Image
            alt=""
            aria-hidden="true"
            className="user-avatar fb-avatar"
            src={user.image}
            width={32}
            height={32}
            unoptimized
          />
        ) : (
          <span className="fb-avatar" aria-hidden="true">
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
