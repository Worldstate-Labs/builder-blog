import Link from "next/link";
import type { Session } from "next-auth";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";

type PublicHeaderPage = "home" | "login" | "privacy" | "terms";

export function PublicHeader({
  current,
  session,
}: {
  current: PublicHeaderPage;
  session?: Session | null;
}) {
  return (
    <>
      <header className="fb-top fb-public-top">
        <div className="fb-top-inner fb-public-top-inner">
          <Link href="/" className="fb-brand">
            <BrandMark />
            <span className="fb-brand-name">FollowBrief</span>
          </Link>
          <div className="fb-public-top-actions">
            <PublicHeaderActions current={current} session={session} surface="desktop" />
          </div>
        </div>
      </header>

      <header className="fb-m-top fb-public-m-top">
        <Link href="/" className="fb-brand">
          <BrandMark />
          <span className="fb-brand-name">FollowBrief</span>
        </Link>
        <span className="fb-m-spacer" />
        <div className="fb-public-mobile-actions">
          <PublicHeaderActions current={current} session={session} surface="mobile" />
        </div>
      </header>
    </>
  );
}

type PublicHeaderSurface = "desktop" | "mobile";

function PublicHeaderActions({
  current,
  session,
  surface,
}: {
  current: PublicHeaderPage;
  session?: Session | null;
  surface: PublicHeaderSurface;
}) {
  const isLegalPage = current === "privacy" || current === "terms";
  const showSignIn = current !== "login" && !session;
  const showMobileLegalLinks = surface === "mobile" && isLegalPage && !session;

  if (isLegalPage) {
    return session ? (
      <UserMenu compact session={session} />
    ) : (
      <>
        {showMobileLegalLinks ? (
          <>
            <Link className="fb-login-nav-link" href="/privacy">
              Privacy
            </Link>
            <Link className="fb-login-nav-link" href="/terms">
              Terms
            </Link>
          </>
        ) : null}
        <Link className="fb-btn dark fb-public-header-primary" href="/login">
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <ThemeToggle />
      {current !== "home" ? (
        <Link className="fb-login-nav-link" href="/">
          Home
        </Link>
      ) : null}
      <Link className="fb-login-nav-link" href="/privacy">
        Privacy
      </Link>
      <Link className="fb-login-nav-link" href="/terms">
        Terms
      </Link>
      {showSignIn ? (
        <Link className="fb-btn dark fb-public-header-primary" href="/login">
          Sign in
        </Link>
      ) : null}
    </>
  );
}
