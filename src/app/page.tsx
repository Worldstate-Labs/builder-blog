import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, Radio, Search, Sparkles, Terminal, UsersRound } from "lucide-react";
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
            Keep up with people<br />and sources you follow.
          </h1>
          <p className="fb-public-copy">
            Follow creators, newsletters, channels, feeds, and private sources,
            then turn their updates into cited AI briefs and a searchable archive.
          </p>
          <div className="fb-public-actions">
            <Link className="fb-btn dark" href="/login">
              Open workspace
            </Link>
            <a className="fb-btn light" href="#how-it-works">
              See workflow
            </a>
          </div>
          <div className="fb-public-flow" aria-label="FollowBrief workflow">
            {["Follow", "Brief", "Search"].map((step) => (
              <span className="fb-public-flow-step" key={step}>
                {step}
              </span>
            ))}
          </div>
        </div>

        <div className="fb-hero-panel" aria-label="FollowBrief product preview">
          <div className="fb-product-preview-head">
            <div className="fb-product-preview-title-row">
              <BrandMark />
              <div>
                <div className="fb-product-preview-title">Today&apos;s digest</div>
                <div className="fb-product-preview-kicker">
                  Preview
                </div>
              </div>
            </div>
            <span className="fb-chip success">
              <Radio aria-hidden="true" />
              Sample
            </span>
          </div>
          <div className="fb-product-preview-list">
            {[
              {
                title: "Context windows became product infrastructure.",
                detail:
                  "Launch notes, essays, podcasts, and pricing shifts grouped into one readable brief.",
              },
              {
                title: "Private sources belong in the brief.",
                detail:
                  "Personal feeds can carry paid newsletters, YouTube transcripts, and private source notes.",
              },
              {
                title: "Search is the memory layer.",
                detail:
                  "Digests, summarized items, and followed sources stay queryable after the daily read is done.",
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
            Built around the loop of following, briefing, and returning to sources later.
          </span>
        </div>
        <ol className="fb-public-step-list">
          {[
            {
              i: "01",
              icon: UsersRound,
              title: "Choose sources",
              copy: "Start from shared libraries, then add people, publications, and private sources your local helper can reach.",
            },
            {
              i: "02",
              icon: Terminal,
              title: "Generate briefs",
              copy: "Use a local helper to summarize followed sources and save the digest.",
            },
            {
              i: "03",
              icon: Archive,
              title: "Keep memory",
              copy: "Browse today, open the items behind each brief, and search the full archive when a detail matters later.",
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
            icon={Sparkles}
            title="Digest-first home"
            copy="Today stays focused on readable briefings, not raw feed noise."
          />
          <Feature
            icon={Search}
            title="Library search"
            copy="Sources, saved items, and digest history share one search surface."
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
  icon: typeof Sparkles;
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
