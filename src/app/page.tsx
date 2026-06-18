import Link from "next/link";
import { redirect } from "next/navigation";
import { Newspaper, Radio, Rss, Search, Terminal } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getCurrentSession } from "@/lib/auth";

export default async function Home() {
  const session = await getCurrentSession();
  if (session) redirect("/dashboard");

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

      <section className="fb-public-section fb-public-hero">
        <div>
          <h1 className="fb-public-title">
            Keep up with sources worth following.{" "}
            <span className="fb-public-title-break">Read them as one AI Digest.</span>
          </h1>
          <p className="fb-public-copy">
            Follow blogs, channels, feeds, GitHub Trending, and Product Hunt.
            Your Local Agent fetches updates, summarizes posts, and builds a
            cited AI Digest.
          </p>
          <div className="fb-public-actions">
            <Link className="fb-btn dark" href="/login">
              Sign in to workspace
            </Link>
            <a className="fb-btn light" href="#how-it-works">
              See workflow
            </a>
          </div>
          <div className="fb-public-flow" aria-label="FollowBrief workflow">
            {["Follow sources", "Build AI Digest", "Search workspace"].map((step) => (
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
                <div className="fb-product-preview-title">Daily AI Digest flow</div>
                <div className="fb-product-preview-kicker">
                  Preview
                </div>
              </div>
            </div>
            <span className="fb-chip success" aria-label="Preview data">
              <Terminal aria-hidden="true" />
              Local Agent loop
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
              <span>Search workspace</span>
            </div>
          </div>
          <div className="fb-product-preview-list">
            {[
              {
                title: "Daily updates become one AI Digest.",
                detail:
                  "New posts, videos, launches, and trending projects are grouped into a readable AI Digest.",
              },
              {
                title: "Your sources stay connected.",
                detail:
                  "Start from shared source libraries, then add sources that matter to your own workflow.",
              },
              {
                title: "Search after the read.",
                detail:
                  "Find sources, posts, and AI Digest archives when you need the detail later.",
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
            Built around the loop of following sources, reading the AI Digest, and returning to sources later.
          </span>
        </div>
        <ol className="fb-public-step-list">
          {[
            {
              i: "01",
              icon: Rss,
              title: "Choose sources",
              copy: "Start from shared source libraries, then add blogs, channels, feeds, GitHub Trending, Product Hunt, and agent-fetchable sources.",
            },
            {
              i: "02",
              icon: Terminal,
              title: "Build AI Digest",
              copy: "Let your Local Agent fetch updates, summarize posts, and build a cited AI Digest from the summaries.",
            },
            {
              i: "03",
              icon: Search,
              title: "Search and revisit",
              copy: "Open the original posts behind each summary and search sources, posts, and AI Digest archives later.",
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
            Calm enough for daily use. Dense enough for real recall.
          </h2>
        </div>
        <div className="fb-public-feature-grid">
          <Feature
            icon={Newspaper}
            title="Home reading lanes"
            copy="AI Digest, Following, and Favorites stay separate, so catch-up and deeper reading do not compete."
          />
          <Feature
            icon={Radio}
            title="Following posts"
            copy="Unread posts from followed sources stay separate from the AI Digest."
          />
          <Feature
            icon={Search}
            title="Workspace search"
            copy="Sources, posts, and AI Digest archives share one search surface."
          />
        </div>
      </section>
    </main>
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
