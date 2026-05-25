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
    <main className="fb-landing-grid min-h-screen px-6 py-6 md:px-9">
      <nav className="mx-auto flex max-w-7xl items-center justify-between">
        <Link href="/" className="fb-brand">
          <BrandMark />
          <span className="fb-brand-name serif text-xl">FollowBrief</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link className="fb-btn dark" href="/login">
            Sign in
          </Link>
        </div>
      </nav>

      <section className="mx-auto grid max-w-7xl items-center gap-10 py-12 lg:grid-cols-[0.95fr_1.05fr] lg:py-16">
        <div>
          <h1 className="serif text-5xl font-semibold leading-[1.02] tracking-tight text-[var(--ink)] md:text-6xl lg:text-[3.6rem]">
            Keep up with people<br />and sources you follow.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--muted-strong)]">
            Follow creators, newsletters, channels, feeds, and private sources,
            then turn their updates into cited AI briefs and a searchable archive.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <Link className="fb-btn dark" href="/login">
              Open workspace
            </Link>
            <a className="fb-btn light" href="#how-it-works">
              See workflow
            </a>
          </div>
          <div className="mt-7 grid max-w-xl gap-2.5 sm:grid-cols-3">
            <MiniMetric label="Sources" value="Central + personal" />
            <MiniMetric label="Output" value="Daily digest" />
            <MiniMetric label="Recall" value="Searchable archive" />
          </div>
        </div>

        <div className="fb-hero-panel" aria-label="FollowBrief product preview">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <div>
                <div className="text-sm font-bold">Today&apos;s digest</div>
                <div className="text-xs text-[var(--muted-strong)]">
                  Synced 12 minutes ago
                </div>
              </div>
            </div>
            <span className="fb-chip success">
              <Radio aria-hidden="true" />
              Live
            </span>
          </div>
          <div className="grid gap-3 p-5">
            {[
              {
                title: "Model context windows moved from spec sheet to product primitive.",
                detail:
                  "Launch notes, essays, podcasts, and pricing shifts grouped into one readable brief.",
              },
              {
                title: "Agent-native ingestion is now the differentiator.",
                detail:
                  "Personal feeds can carry paid newsletters, YouTube transcripts, and private source notes.",
              },
              {
                title: "Search is the memory layer.",
                detail:
                  "Digests, crawled items, and followed sources stay queryable after the daily read is done.",
              },
            ].map((item) => (
              <article className="fb-signal" key={item.title}>
                <span className="fb-signal-dot" />
                <div className="min-w-0">
                  <h2 className="text-sm font-bold leading-snug">{item.title}</h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted-strong)]">
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
        className="mx-auto max-w-7xl border-t border-[var(--line)] pt-8 pb-12"
      >
        <div className="flex items-center gap-4">
          <span className="fb-section-label">Workflow</span>
          <span className="text-xs text-[var(--muted-strong)]">
            Built around the loop of following, briefing, and returning to sources later.
          </span>
        </div>
        <div className="mt-5 grid gap-3.5 md:grid-cols-3">
          {[
            {
              i: "01",
              icon: UsersRound,
              title: "Choose sources",
              copy: "Start from shared libraries, then add people, publications, and private sources your agent can reach.",
            },
            {
              i: "02",
              icon: Terminal,
              title: "Generate briefs",
              copy: "Run the terminal skill to summarize followed sources and push the digest into the app.",
            },
            {
              i: "03",
              icon: Archive,
              title: "Keep memory",
              copy: "Browse today, inspect crawled inputs, and search the full archive when a detail matters later.",
            },
          ].map(({ i, icon: Icon, title, copy }) => (
            <div key={title} className="fb-panel">
              <div className="flex items-center justify-between">
                <span className="fb-section-label">{i}</span>
                <Icon className="h-[18px] w-[18px] text-[var(--accent)]" aria-hidden="true" />
              </div>
              <h2 className="serif mt-3.5 text-2xl font-semibold leading-snug tracking-tight">
                {title}
              </h2>
              <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--muted-strong)]">
                {copy}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 border-t border-[var(--line)] py-10 md:grid-cols-[0.9fr_1.1fr]">
        <div>
          <span className="fb-section-label">Product surface</span>
          <h2 className="serif mt-3 text-3xl font-semibold leading-tight tracking-tight">
            Calm enough for daily use. Dense enough for real recall.
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Feature
            icon={Sparkles}
            title="Digest-first home"
            copy="Today stays focused on generated briefings, not raw crawl noise."
          />
          <Feature
            icon={Search}
            title="Library search"
            copy="Sources, feed inputs, and digest history share one retrieval surface."
          />
        </div>
      </section>
    </main>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2.5">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
        {label}
      </div>
      <div className="mt-1.5 text-[13px] font-semibold text-[var(--ink)]">{value}</div>
    </div>
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
      <Icon className="mt-1 h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
      <div>
        <h3 className="serif text-xl font-semibold">{title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted-strong)]">{copy}</p>
      </div>
    </article>
  );
}
