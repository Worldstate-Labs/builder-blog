import { BuilderKind, BuilderScope, FeedItemKind } from "@prisma/client";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { addCentralBuilderAction, deleteCentralBuilderAction } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  builderKindLabel,
  builderSourceLabel,
  feedItemKindLabel,
  SOURCE_DEFINITIONS,
} from "@/lib/source-registry";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

export default async function AdminPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  if (!isAdminEmail(session.user.email)) redirect("/dashboard?error=admin-required");

  return (
    <AppShell session={session}>
      <div className="page-pad">
        <section className="grid gap-6 xl:grid-cols-[1fr_26rem]">
          <div>
            <p className="section-label">Admin</p>
            <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-6xl">
              Crawl operations
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
              Review the central builder pool, canonical de-dupe keys, and the
              feed items imported by day.
            </p>
          </div>
          <Suspense fallback={<AdminStatsFallback />}>
            <AdminStats />
          </Suspense>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          <Suspense fallback={<MetricPanelFallback title="Builder pool by kind" />}>
            <BuilderKindMetrics />
          </Suspense>
          <Suspense fallback={<MetricPanelFallback title="Feed items by kind" />}>
            <FeedKindMetrics />
          </Suspense>
        </section>

        <Suspense fallback={<AdminPanelFallback title="Canonical sources" />}>
          <CentralBuilderPool />
        </Suspense>

        <Suspense fallback={<AdminPanelFallback title="Recent imported content" />}>
          <RecentImportedContent />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function AdminStats() {
  const since = recentImportSince();
  const [centralBuilderCount, personalBuilderCount, recentFeedItemCount] = await Promise.all([
    prisma.builder.count({ where: { scope: BuilderScope.CENTRAL } }),
    prisma.builder.count({ where: { scope: BuilderScope.PERSONAL } }),
    prisma.feedItem.count({
      where: { createdAt: { gte: since }, builder: { scope: BuilderScope.CENTRAL } },
    }),
  ]);

  return (
    <div className="stats-panel">
      <AdminStat label="Pool builders" value={centralBuilderCount} />
      <AdminStat label="Personal builders" value={personalBuilderCount} />
      <AdminStat label="Recent crawled items" value={recentFeedItemCount} />
    </div>
  );
}

function AdminStatsFallback() {
  return (
    <div className="stats-panel" aria-live="polite" aria-busy="true">
      <div className="h-16 rounded-lg bg-black/10" />
      <div className="h-16 rounded-lg bg-black/10" />
      <div className="h-16 rounded-lg bg-black/10" />
    </div>
  );
}

async function BuilderKindMetrics() {
  const builderKindCounts = await prisma.builder.groupBy({
    by: ["kind"],
    where: { scope: BuilderScope.CENTRAL },
    _count: { _all: true },
  });

  return (
    <div className="admin-panel">
      <h2 className="font-serif text-3xl">Builder pool by kind</h2>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {Object.values(BuilderKind).map((kind) => (
          <MetricRow
            key={kind}
            label={builderKindLabel(kind)}
            value={builderKindCounts.find((item) => item.kind === kind)?._count._all ?? 0}
          />
        ))}
      </div>
    </div>
  );
}

async function FeedKindMetrics() {
  const feedKindCounts = await prisma.feedItem.groupBy({
    by: ["kind"],
    where: { builder: { scope: BuilderScope.CENTRAL } },
    _count: { _all: true },
  });

  return (
    <div className="admin-panel">
      <h2 className="font-serif text-3xl">Feed items by kind</h2>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {Object.values(FeedItemKind).map((kind) => (
          <MetricRow
            key={kind}
            label={feedItemKindLabel(kind)}
            value={feedKindCounts.find((item) => item.kind === kind)?._count._all ?? 0}
          />
        ))}
      </div>
    </div>
  );
}

function MetricPanelFallback({ title }: { title: string }) {
  return (
    <div className="admin-panel" aria-live="polite" aria-busy="true">
      <h2 className="font-serif text-3xl">{title}</h2>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="h-14 rounded-lg bg-black/10" />
        <div className="h-14 rounded-lg bg-black/10" />
        <div className="h-14 rounded-lg bg-black/10" />
        <div className="h-14 rounded-lg bg-black/10" />
      </div>
    </div>
  );
}

async function CentralBuilderPool() {
  const builders = await prisma.builder.findMany({
    where: { scope: BuilderScope.CENTRAL },
    include: { _count: { select: { subscriptions: true, feedItems: true } } },
    orderBy: [{ kind: "asc" }, { updatedAt: "desc" }, { name: "asc" }],
  });

  return (
    <section className="mt-10">
      <div className="admin-panel mb-5">
        <h2 className="font-serif text-3xl">Add central builder</h2>
        <form action={addCentralBuilderAction} className="mt-5 grid gap-3 md:grid-cols-[1fr_12rem_12rem_1fr_1fr_auto]">
          <input className="input" name="name" placeholder="Name" required />
          <select className="input" name="kind" defaultValue={BuilderKind.X}>
            {Object.values(BuilderKind).map((kind) => (
              <option key={kind} value={kind}>
                {builderKindLabel(kind)}
              </option>
            ))}
          </select>
          <select className="input" name="sourceType" defaultValue="auto">
            <option value="auto">Auto source</option>
            {SOURCE_DEFINITIONS.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
          <input className="input" name="handle" placeholder="X handle" />
          <input className="input" name="sourceUrl" placeholder="URL or RSS" />
          <FormSubmitButton className="button-dark button-compact justify-self-start" pendingLabel="Adding...">
            Add
          </FormSubmitButton>
        </form>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-label">Builder pool</p>
          <h2 className="mt-2 font-serif text-4xl">Canonical sources</h2>
        </div>
        <span className="rounded-full border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-2 text-sm text-[var(--muted-strong)]">
          {builders.length} builders · unique by canonicalKey
        </span>
      </div>

      <div className="item-list mt-5">
        {builders.map((builder) => (
          <article key={builder.id} className="admin-panel admin-panel-compact">
            <div className="item-summary item-summary-static">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-serif text-2xl">{builder.name}</h3>
                  <span className="kind-pill">{builderSourceLabel(builder)}</span>
                </div>
                <p className="mt-2 truncate text-sm text-[var(--muted)]">
                  {builder.handle ? `@${builder.handle}` : builder.sourceUrl}
                </p>
              </div>
              <div className="row-actions text-right text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                <span>{builder._count.feedItems} items</span>
                <span>{builder._count.subscriptions} subscribers</span>
                <form action={deleteCentralBuilderAction} className="m-0">
                  <input type="hidden" name="builderId" value={builder.id} />
                  <FormSubmitButton className="button-light button-compact" pendingLabel="Removing...">
                    Remove
                  </FormSubmitButton>
                </form>
              </div>
            </div>
            <details className="inline-disclosure border-t border-[var(--line)] px-4 py-3">
              <summary>IDs and crawl source</summary>
              <dl className="mt-3 grid gap-3 text-xs md:grid-cols-3">
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">Unique id</dt>
                  <dd className="mt-1 break-all font-mono text-[var(--muted-strong)]">
                    {builder.id}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">Canonical key</dt>
                  <dd className="mt-1 break-all font-mono text-[var(--muted-strong)]">
                    {builder.canonicalKey}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">Crawl source</dt>
                  <dd className="mt-1 break-all text-[var(--muted-strong)]">
                    {builder.crawlUrl ?? builder.sourceUrl ?? "No crawl URL"}
                  </dd>
                </div>
              </dl>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}

async function RecentImportedContent() {
  const since = recentImportSince();
  const feedItems = await prisma.feedItem.findMany({
    where: { createdAt: { gte: since }, builder: { scope: BuilderScope.CENTRAL } },
    include: { builder: true },
    orderBy: [{ createdAt: "desc" }, { publishedAt: "desc" }],
    take: 160,
  });
  const feedItemsByDay = groupItemsByCreatedDay(feedItems);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-label">Daily crawl</p>
          <h2 className="mt-2 font-serif text-4xl">Recent imported content</h2>
        </div>
        <span className="rounded-full border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-2 text-sm text-[var(--muted-strong)]">
          Last 14 days
        </span>
      </div>

      <div className="item-list mt-5">
        {feedItemsByDay.map((day, dayIndex) => (
          <details key={day.key} className="admin-panel admin-panel-compact" open={dayIndex === 0}>
            <summary className="item-summary">
              <h3 className="font-serif text-3xl">{dateFormatter.format(day.date)}</h3>
              <span className="kind-pill">{day.items.length} items</span>
            </summary>
            <div className="border-t border-[var(--line)]">
              {day.items.map((item) => (
                <details key={item.id} className="item-disclosure item-row-disclosure">
                  <summary className="item-summary">
                    <span className="min-w-0">
                      <span className="item-kicker">
                        <span>{feedItemKindLabel(item.kind)}</span>
                        <span>{timeFormatter.format(item.createdAt)}</span>
                        <span>{item.builder?.name ?? item.sourceName ?? "Unknown source"}</span>
                      </span>
                      <span className="item-title">{item.title || firstLine(item.body)}</span>
                    </span>
                    <span className="item-summary-action">Details</span>
                  </summary>
                  <div className="item-details">
                    <p className="text-sm leading-6 text-[var(--muted-strong)]">
                      {firstLine(item.body)}
                    </p>
                    <dl className="mt-4 grid gap-2 text-xs md:grid-cols-2">
                      <div>
                        <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">External id</dt>
                        <dd className="mt-1 break-all font-mono">{item.externalId}</dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-[0.12em] text-[var(--muted)]">Canonical key</dt>
                        <dd className="mt-1 break-all font-mono">
                          {item.builder?.canonicalKey ?? "No builder"}
                        </dd>
                      </div>
                    </dl>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-block text-sm font-semibold underline"
                    >
                      Open source
                    </a>
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
        {feedItemsByDay.length === 0 ? (
          <div className="admin-panel text-[var(--muted-strong)]">
            No feed items were created in the last 14 days.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AdminPanelFallback({ title }: { title: string }) {
  return (
    <section className="mt-10" aria-live="polite" aria-busy="true">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-label">Loading</p>
          <h2 className="mt-2 font-serif text-4xl">{title}</h2>
        </div>
      </div>
      <div className="item-list mt-5">
        <div className="h-24 rounded-lg bg-black/10" />
        <div className="h-24 rounded-lg bg-black/10" />
        <div className="h-24 rounded-lg bg-black/10" />
      </div>
    </section>
  );
}

function recentImportSince() {
  return new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
}

function AdminStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card stat-card-plain">
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value">{value}</div>
    </div>
  );
}

function groupItemsByCreatedDay<T extends { createdAt: Date }>(items: T[]) {
  const groups = new Map<string, { key: string; date: Date; items: T[] }>();
  for (const item of items) {
    const key = item.createdAt.toISOString().slice(0, 10);
    const group = groups.get(key) ?? { key, date: item.createdAt, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function firstLine(body: string) {
  return body.split(/\r?\n/).find(Boolean)?.slice(0, 120) ?? "Untitled item";
}
