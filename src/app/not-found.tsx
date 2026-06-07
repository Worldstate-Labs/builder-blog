import Link from "next/link";
import { Home, Search } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function NotFound() {
  return (
    <main className="fb-landing-grid min-h-screen">
      <nav className="fb-public-nav">
        <Link href="/" className="fb-brand">
          <BrandMark />
          <span className="fb-brand-name">FollowBrief</span>
        </Link>
        <div className="fb-public-nav-actions">
          <ThemeToggle />
          <Link className="fb-btn dark" href="/login">
            Sign in
          </Link>
        </div>
      </nav>

      <section className="fb-public-section fb-public-workspace">
        <div>
          <span className="fb-section-label">404</span>
          <h1 className="fb-public-section-title fb-public-section-title-spaced">
            Nothing to open here.
          </h1>
          <p className="fb-public-copy">
            This public link may have moved, expired, or belongs inside a
            signed-in FollowBrief workspace.
          </p>
        </div>
        <div className="fb-public-actions">
          <Link className="fb-btn dark" href="/">
            <Home aria-hidden="true" />
            Home
          </Link>
          <Link className="fb-btn light" href="/search">
            <Search aria-hidden="true" />
            Search workspace
          </Link>
        </div>
      </section>
    </main>
  );
}
