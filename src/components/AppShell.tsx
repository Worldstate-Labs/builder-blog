import Link from "next/link";
import type { Session } from "next-auth";
import { AppNav, type AppNavItem } from "@/components/AppNav";
import { BrandMark } from "@/components/BrandMark";
import { HeaderAccountControls } from "@/components/HeaderAccountControls";
import { MobileSearchLink } from "@/components/MobileSearchLink";
import { SearchForm } from "@/components/SearchForm";
import { isAdminEmail } from "@/lib/admin";

const nav: AppNavItem[] = [
  { href: "/builders", label: "Sources", icon: "sources" },
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
            <HeaderAccountControls isAdmin={isAdmin} session={session} />
          </div>
        </div>
      </header>

      <header className="fb-m-top">
        <Link href="/dashboard" className="fb-brand">
          <BrandMark />
          <span className="fb-brand-name">FollowBrief</span>
        </Link>
        <span className="fb-m-spacer" />
        <MobileSearchLink />
        <HeaderAccountControls isAdmin={isAdmin} session={session} />
      </header>

      <div className="app-body">
        <div className="fb-side-rail">
          <AppNav desktopLayout="rail" items={nav} mode="desktop" />
        </div>
        <main className="app-main">
          {children}
          <AppNav items={nav} mode="mobile" />
        </main>
      </div>
    </div>
  );
}
