import Link from "next/link";
import { redirect } from "next/navigation";
import { Newspaper, Radio, Rss, Search, Terminal } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { PublicHeader } from "@/components/PublicHeader";
import { getCurrentSession } from "@/lib/auth";

export default async function Home() {
  const session = await getCurrentSession();
  if (session) redirect("/dashboard");

  return (
    <>
      <PublicHeader current="home" />
      <main className="fb-landing-grid min-h-screen">
      <section className="fb-public-section fb-public-hero">
        <div>
          <h1 className="fb-public-title">
            Follow sources worth reading.{" "}
            <span className="fb-public-title-break">Read their updates as one cited AI Digest.</span>
          </h1>
          <p className="fb-public-copy">
            Follow blogs, channels, feeds, GitHub Trending, and Product Hunt.
            Your Local Agent fetches updates, summarizes source material, and
            builds a cited AI Digest you can search later.
          </p>
          <div className="fb-public-actions">
            <Link className="fb-btn dark" href="/login">
              Sign in
            </Link>
            <a className="fb-btn light" href="#how-it-works">
              See workflow
            </a>
          </div>
          <div className="fb-public-flow" aria-label="FollowBrief workflow">
            {["Follow sources", "Build AI Digest", "Search"].map((step) => (
              <span className="fb-public-flow-step" key={step}>
                {step}
              </span>
            ))}
          </div>
        </div>

        <div className="fb-hero-panel" aria-label="FollowBrief product demo">
          <div className="fb-product-preview-head">
            <div className="fb-product-preview-title-row">
              <BrandMark />
              <div>
                <div className="fb-product-preview-title">AI Digest workflow</div>
                <div className="fb-product-preview-kicker">
                  Sources, citations, recall
                </div>
              </div>
            </div>
            <span className="fb-chip success" aria-label="Preview data">
              <Terminal aria-hidden="true" />
              Local Agent
            </span>
          </div>
          <div className="fb-product-demo" aria-hidden="true">
            <div className="fb-demo-sources">
              {["GitHub Trending", "Product Hunt", "YouTube", "Blogs"].map((source) => (
                <span className="fb-demo-source" key={source}>
                  {source}
                </span>
              ))}
            </div>
            <div className="fb-demo-rail">
              <span className="fb-demo-pulse" />
            </div>
            <div className="fb-demo-card">
              <div className="fb-demo-card-head">
                <span>AI Digest</span>
                <span>cited</span>
              </div>
              <div className="fb-demo-line is-strong" />
              <div className="fb-demo-line" />
              <div className="fb-demo-line is-short" />
            </div>
            <div className="fb-demo-search">
              <Search aria-hidden="true" />
              <span>Search</span>
            </div>
          </div>
          <div className="fb-product-preview-list">
            {[
              {
                title: "One cited AI Digest",
                detail: "Posts, videos, launches, and projects stay readable together.",
              },
              {
                title: "Sources stay visible",
                detail: "Each summary keeps a path back to the original post.",
              },
              {
                title: "Search later",
                detail: "Find sources, posts, and AI Digest issues when details matter.",
              },
            ].map((item) => (
              <article className="fb-signal" key={item.title}>
                <span className="fb-signal-dot" />
                <div className="fb-signal-copy">
                  <h2 className="fb-signal-title">{item.title}</h2>
                  <p className="fb-signal-desc">
                    {item.detail}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="fb-public-section fb-public-workflow"
      >
        <div className="fb-public-section-kicker-row">
          <span className="fb-section-label">Workflow</span>
          <span className="fb-public-section-note">
            Follow sources, build a cited AI Digest, search later.
          </span>
        </div>
        <ol className="fb-public-step-list">
          {[
            {
              i: "01",
              icon: Rss,
              title: "Follow sources",
              copy: "Start from shared source libraries, then add blogs, channels, feeds, GitHub Trending, and Product Hunt.",
            },
            {
              i: "02",
              icon: Terminal,
              title: "Build the AI Digest",
              copy: "The Local Agent fetches updates, summarizes source material, and assembles a cited AI Digest.",
            },
            {
              i: "03",
              icon: Search,
              title: "Search and revisit",
              copy: "Open originals and search sources, posts, and AI Digest issues later.",
            },
          ].map(({ i, icon: Icon, title, copy }) => (
            <li key={title} className="fb-public-step-row">
              <span className="fb-public-step-index">{i}</span>
              <div className="fb-public-step-body">
                <div className="fb-public-step-title-row">
                  <Icon className="fb-public-step-icon" aria-hidden="true" />
                  <h2 className="fb-public-card-title">{title}</h2>
                </div>
                <p className="fb-public-card-copy">
                  {copy}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="fb-public-section fb-public-workspace">
        <div>
          <span className="fb-section-label">Workspace</span>
          <h2 className="fb-public-section-title fb-public-section-title-spaced">
            Quiet enough for daily reading. Structured enough for recall.
          </h2>
        </div>
        <div className="fb-public-feature-grid">
          <Feature
            icon={Newspaper}
            title="Today reading lanes"
            copy="AI Digest, Following, and Favorites stay separate so catch-up stays focused."
          />
          <Feature
            icon={Radio}
            title="Following posts"
            copy="Unread posts stay separate from generated AI Digest issues."
          />
          <Feature
            icon={Search}
            title="Search"
            copy="Sources, posts, and AI Digest issues share one search surface."
          />
        </div>
      </section>
      <footer className="fb-public-section">
        <div className="fb-public-nav-actions">
          <Link className="fb-login-nav-link" href="/privacy">
            Privacy
          </Link>
          <Link className="fb-login-nav-link" href="/terms">
            Terms
          </Link>
        </div>
      </footer>
      </main>
    </>
  );
}

function Feature({
  icon: Icon,
  title,
  copy,
}: {
  icon: typeof Newspaper;
  title: string;
  copy: string;
}) {
  return (
    <article className="fb-signal">
      <Icon className="fb-public-feature-icon" aria-hidden="true" />
      <div>
        <h3 className="fb-public-card-title">{title}</h3>
        <p className="fb-public-card-copy is-compact">{copy}</p>
      </div>
    </article>
  );
}
