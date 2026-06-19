import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function PrivacyPage() {
  return (
    <main className="fb-landing-grid min-h-screen">
      <nav className="fb-public-nav">
        <Link href="/" className="fb-brand">
          <BrandMark />
          <span className="fb-brand-name">FollowBrief</span>
        </Link>
        <div className="fb-public-nav-actions">
          <ThemeToggle />
          <Link className="fb-btn light" href="/terms">
            Terms
          </Link>
          <Link className="fb-btn dark" href="/login">
            Sign in
          </Link>
        </div>
      </nav>

      <section className="fb-public-section">
        <div>
          <span className="fb-section-label">Privacy</span>
          <h1 className="fb-public-title">FollowBrief Privacy Policy</h1>
          <p className="fb-public-copy">
            This policy explains what FollowBrief collects, why it is used, how
            Hub sharing works, and how you can access, export, correct, or
            delete account data.
          </p>
        </div>

        <div className="fb-public-feature-grid">
          <PolicyBlock
            title="Data we collect"
            copy="We store your OAuth profile, email, sources, subscriptions, read history, favorites, AI Digest issues, settings, access keys, Local Agent activity, IP address, and User-Agent details needed to operate the app and protect your account."
          />
          <PolicyBlock
            title="How we use it"
            copy="FollowBrief uses this data to fetch source updates, build cited AI Digest issues, keep search and recommendations useful, secure sessions, diagnose failures, and show account activity in Settings."
          />
          <PolicyBlock
            title="AI and third parties"
            copy="Source content may be summarized by AI services. FollowBrief also connects with third-party sources and APIs such as Google, GitHub, Apple, X, YouTube, Product Hunt, RSS feeds, websites, and OpenAI-style model providers when you choose those workflows."
          />
          <PolicyBlock
            title="Hub sharing"
            copy="When you share source libraries or AI Digest collections to Hub, other users can see shared source names, source links, collection titles, headline metadata, descriptions, counts, and public Hub activity. Private account data, access keys, and OAuth tokens are not published to Hub."
          />
          <PolicyBlock
            title="Retention"
            copy="We retain account data while your account is active. You can export or delete your account from Settings. Account deletion removes your user record and cascades account, session, token, preference, digest, read, favorite, import, and Hub sharing records, with operational backups expiring under normal retention schedules."
          />
          <PolicyBlock
            title="Your rights"
            copy="You can access, export, correct, and delete your information. Settings includes account export and delete controls. You can also stop sharing any Hub item before deleting your account."
          />
        </div>
      </section>
    </main>
  );
}

function PolicyBlock({ title, copy }: { title: string; copy: string }) {
  return (
    <article className="fb-signal">
      <span className="fb-signal-dot" />
      <div className="fb-signal-copy">
        <h2 className="fb-signal-title">{title}</h2>
        <p className="fb-signal-desc">{copy}</p>
      </div>
    </article>
  );
}
