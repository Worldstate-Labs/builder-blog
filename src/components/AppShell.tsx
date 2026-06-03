import Link from "next/link";
import type { Session } from "next-auth";
import { Search } from "lucide-react";
import { AppNav, type AppNavItem } from "@/components/AppNav";
import { BrandMark } from "@/components/BrandMark";
import { SearchForm } from "@/components/SearchForm";
import { UserMenu } from "@/components/UserMenu";
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
  const isAdmin = isAdminEmail(session?.user?.email);

  return (
    <div className="app-frame">
      <header className="fb-top">
        <div className="fb-top-inner">
          <Link href="/dashboard" className="fb-brand">
            <BrandMark />
            <span className="fb-brand-name">FollowBrief</span>
          </Link>
          <div className="fb-top-search">
            <SearchForm query="" variant="header" />
          </div>
          <div className="fb-top-user">
            <UserMenu compact isAdmin={isAdmin} session={session} />
          </div>
        </div>
      </header>

      <header className="fb-m-top">
        <Link href="/dashboard" className="fb-brand">
          <BrandMark />
          <span className="fb-brand-name">FollowBrief</span>
        </Link>
        <span className="fb-m-spacer" />
        <Link
          href="/search"
          className="fb-m-icon"
          aria-label="Search"
        >
          <Search aria-hidden="true" />
        </Link>
        <UserMenu compact isAdmin={isAdmin} session={session} />
      </header>

      <div className="app-body">
        <aside className="fb-side-rail" aria-label="Primary navigation">
          <AppNav desktopLayout="rail" items={nav} mode="desktop" />
        </aside>
        <main className="app-main">
          {children}
          <AppNav items={nav} mode="mobile" />
        </main>
      </div>
    </div>
  );
}
