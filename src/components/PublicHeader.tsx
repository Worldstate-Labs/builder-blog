import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";

type PublicHeaderPage = "home" | "login" | "privacy" | "terms";

export function PublicHeader({ current }: { current: PublicHeaderPage }) {
  const showSignIn = current !== "login";

  return (
    <>
      <header className="fb-top fb-public-top">
        <div className="fb-top-inner fb-public-top-inner">
          <Link href="/" className="fb-brand">
            <BrandMark />
            <span className="fb-brand-name">FollowBrief</span>
          </Link>
          <div className="fb-public-top-actions">
            <ThemeToggle />
            {current !== "home" ? (
              <Link className="fb-login-nav-link" href="/">
                Home
              </Link>
            ) : null}
            {current !== "privacy" ? (
              <Link className="fb-login-nav-link" href="/privacy">
                Privacy
              </Link>
            ) : null}
            {current !== "terms" ? (
              <Link className="fb-login-nav-link" href="/terms">
                Terms
              </Link>
            ) : null}
            {showSignIn ? (
              <Link className="fb-btn dark fb-public-header-primary" href="/login">
                Sign in
              </Link>
            ) : null}
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
          <ThemeToggle />
          {current !== "home" ? (
            <Link className="fb-login-nav-link" href="/">
              Home
            </Link>
          ) : null}
          {current !== "privacy" ? (
            <Link className="fb-login-nav-link" href="/privacy">
              Privacy
            </Link>
          ) : null}
          {current !== "terms" ? (
            <Link className="fb-login-nav-link" href="/terms">
              Terms
            </Link>
          ) : null}
          {showSignIn ? (
            <Link className="fb-btn dark fb-public-header-primary" href="/login">
              Sign in
            </Link>
          ) : null}
        </div>
      </header>
    </>
  );
}
