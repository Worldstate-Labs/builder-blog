import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, Radio, Search, Sparkles, Terminal, UsersRound } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { getCurrentSession } from "@/lib/auth";

export default async function Home() {
  const session = await getCurrentSession();
  if (session) redirect("/dashboard");

  return (
    <main className="landing-grid min-h-screen px-6 py-6">
      <nav className="mx-auto flex max-w-7xl items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <BrandMark />
          <span className="font-serif text-2xl font-semibold">FollowBrief</span>
        </Link>
        <Link className="button-dark" href="/login">
          Sign in
        </Link>
      </nav>
      <section className="mx-auto grid max-w-7xl items-center gap-12 py-14 lg:grid-cols-[0.95fr_1.05fr] lg:py-20">
        <div className="max-w-3xl">
          <h1 className="font-serif text-5xl font-semibold leading-[0.98] text-[var(--ink)] md:text-7xl">
            Keep up with people and sources you follow.
          </h1>
          <p className="mt-7 max-w-2xl text-xl leading-9 text-[var(--muted-strong)]">
            Follow creators, newsletters, channels, feeds, and private sources,
            then turn their updates into cited AI briefs and a searchable archive.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link className="button-dark" href="/login">
              Open workspace
            </Link>
            <a className="button-light" href="#how-it-works">
              See workflow
            </a>
          </div>
          <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            <MiniMetric label="Sources" value="Central + personal" />
            <MiniMetric label="Output" value="Daily digest" />
            <MiniMetric label="Recall" value="Searchable archive" />
          </div>
        </div>
        <div className="landing-product" aria-label="FollowBrief product preview">
          <div className="landing-product-bar">
            <div className="flex items-center gap-3">
              <BrandMark />
              <div>
                <div className="text-sm font-bold">Today&apos;s digest</div>
                <div className="text-xs text-[var(--muted-strong)]">Synced 12 minutes ago</div>
              </div>
            </div>
            <span className="status-chip status-chip-success">
              <Radio className="h-3.5 w-3.5" />
              Live
            </span>
          </div>
          <div className="landing-product-body">
            {[
              {
                title: "Model context windows moved from spec sheet to product primitive.",
                detail: "Launch notes, essays, podcasts, and pricing shifts are grouped into one readable brief.",
              },
              {
                title: "Agent-native ingestion is now the differentiator.",
                detail: "Personal feeds can carry paid newsletters, YouTube transcripts, and private source notes.",
              },
              {
                title: "Search is the memory layer.",
                detail: "Digests, crawled items, and followed sources stay queryable after the daily read is done.",
              },
            ].map((item) => (
              <article className="signal-row" key={item.title}>
                <span className="signal-dot" />
                <div className="min-w-0">
                  <h2 className="text-base font-bold leading-6">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
                    {item.detail}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section id="how-it-works" className="mx-auto max-w-7xl border-t border-[var(--line)] py-12">
        <div className="page-kicker-row">
          <p className="section-label">Workflow</p>
          <p className="text-sm text-[var(--muted-strong)]">
            Built around the loop of following, briefing, and returning to sources later.
          </p>
        </div>
        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {[
            {
              icon: UsersRound,
              title: "Choose sources",
              copy: "Start from shared libraries, then add people, publications, and private sources your own agent can reach.",
            },
            {
              icon: Terminal,
              title: "Generate briefs",
              copy: "Run the terminal skill to summarize followed sources and push the digest into the app.",
            },
            {
              icon: Archive,
              title: "Keep memory",
              copy: "Browse today, inspect crawled inputs, and search the full archive when a detail matters later.",
            },
          ].map((item, index) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="workflow-card">
                <div className="flex items-center justify-between gap-4">
                  <span className="workflow-card-index">0{index + 1}</span>
                  <Icon className="h-5 w-5 text-[var(--accent)]" />
                </div>
                <h2 className="mt-8 font-serif text-3xl font-semibold">{item.title}</h2>
                <p className="mt-4 text-base leading-7 text-[var(--muted-strong)]">{item.copy}</p>
              </div>
            );
          })}
        </div>
      </section>
      <section className="mx-auto grid max-w-7xl gap-5 border-t border-[var(--line)] py-12 md:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="section-label">Product surface</p>
          <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight">
            Calm enough for daily use. Dense enough for real recall.
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Feature icon={Sparkles} title="Digest-first home" copy="Today stays focused on generated briefings, not raw crawl noise." />
          <Feature icon={Search} title="Library search" copy="Sources, feed inputs, and digest history share one retrieval surface." />
        </div>
      </section>
    </main>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-3">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-strong)]">{label}</div>
      <div className="mt-2 text-sm font-semibold text-[var(--ink)]">{value}</div>
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
    <article className="signal-row">
      <Icon className="mt-1 h-5 w-5 text-[var(--accent)]" />
      <div>
        <h3 className="font-serif text-2xl font-semibold">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{copy}</p>
      </div>
    </article>
  );
}
