import { BuilderKind, FeedItemKind } from "@prisma/client";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminBuilderManager } from "@/components/AdminBuilderManager";
import { adminEmails, isAdminEmail } from "@/lib/admin";
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
    <div className="page-pad">
      <section className="fb-page-head">
        <div>
          <h1 className="fb-title">Summary operations</h1>
          <p className="fb-desc">
            Review the central builder pool, de-dupe keys, and recent imports.
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
  );
}

async function AdminStats() {
  const since = recentImportSince();
  const [centralBuilderCount, personalBuilderCount, recentFeedItemCount] = await Promise.all([
    prisma.builder.count({ where: { owner: { email: { in: adminEmails() } } } }),
    prisma.builder.count({ where: { owner: { email: { notIn: adminEmails() } } } }),
    prisma.feedItem.count({
      where: { createdAt: { gte: since }, builder: { owner: { email: { in: adminEmails() } } } },
    }),
  ]);

  return (
    <div className="stats-panel">
      <AdminStat label="Pool sources" value={centralBuilderCount} />
      <AdminStat label="Personal sources" value={personalBuilderCount} />
      <AdminStat label="Recent summarized items" value={recentFeedItemCount} />
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
    where: { owner: { email: { in: adminEmails() } } },
    _count: { _all: true },
  });

  return (
    <div className="fb-panel">
      <h2 className="fb-section-heading">Builder pool by kind</h2>
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
    where: { builder: { owner: { email: { in: adminEmails() } } } },
    _count: { _all: true },
  });

  return (
    <div className="fb-panel">
      <h2 className="fb-section-heading">Feed items by kind</h2>
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
    <div className="fb-panel" aria-live="polite" aria-busy="true">
      <h2 className="fb-section-heading">{title}</h2>
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
    where: { owner: { email: { in: adminEmails() } } },
    include: { _count: { select: { subscriptions: true, feedItems: true } } },
    orderBy: [{ kind: "asc" }, { updatedAt: "desc" }, { name: "asc" }],
  });

  return (
    <AdminBuilderManager
      builderKindOptions={Object.values(BuilderKind).map((kind) => ({
        label: builderKindLabel(kind),
        value: kind,
      }))}
      initialBuilders={builders.map((builder) => ({
        id: builder.id,
        name: builder.name,
        handle: builder.handle,
        sourceUrl: builder.sourceUrl,
        crawlUrl: builder.crawlUrl,
        canonicalKey: builder.canonicalKey,
        sourceLabel: builderSourceLabel(builder),
        feedItemCount: builder._count.feedItems,
        subscriptionCount: builder._count.subscriptions,
      }))}
      sourceOptions={SOURCE_DEFINITIONS.map((source) => ({
        label: source.label,
        value: source.id,
      }))}
    />
  );
}

async function RecentImportedContent() {
  const since = recentImportSince();
  const feedItems = await prisma.feedItem.findMany({
    where: { createdAt: { gte: since }, builder: { owner: { email: { in: adminEmails() } } } },
    include: { builder: true },
    orderBy: [{ createdAt: "desc" }, { publishedAt: "desc" }],
    take: 160,
  });
  const feedItemsByDay = groupItemsByCreatedDay(feedItems);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="fb-section-label">Daily summary</p>
          <h2 className="fb-section-heading mt-1">Recent imported content</h2>
        </div>
        <span className="fb-chip">Last 14 days</span>
      </div>

      <div className="mt-5 grid gap-3">
        {feedItemsByDay.map((day, dayIndex) => (
          <details
            key={day.key}
            className="fb-panel"
            style={{ padding: 0 }}
            open={dayIndex === 0}
          >
            <summary className="item-summary">
              <h3 className="text-lg font-semibold">{dateFormatter.format(day.date)}</h3>
              <span className="fb-kind-pill">{day.items.length} items</span>
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
          <p className="fb-section-label">Loading</p>
          <h2 className="fb-section-heading">{title}</h2>
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
    <div className="fb-stat">
      <div className="min-w-0">
        <div className="fb-stat-value">{value}</div>
        <div className="fb-stat-label">{label}</div>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="fb-stat">
      <div className="min-w-0">
        <div className="fb-stat-value">{value}</div>
        <div className="fb-stat-label">{label}</div>
      </div>
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
