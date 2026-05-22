import { BuilderKind, FeedItemKind } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const since = new Date(new Date().getTime() - 14 * 24 * 60 * 60 * 1000);
  const [builders, feedItems, builderKindCounts, feedKindCounts] = await Promise.all([
    prisma.builder.findMany({
      include: { _count: { select: { subscriptions: true, feedItems: true } } },
      orderBy: [{ kind: "asc" }, { updatedAt: "desc" }, { name: "asc" }],
    }),
    prisma.feedItem.findMany({
      where: { createdAt: { gte: since } },
      include: { builder: true },
      orderBy: [{ createdAt: "desc" }, { publishedAt: "desc" }],
      take: 160,
    }),
    prisma.builder.groupBy({
      by: ["kind"],
      _count: { _all: true },
    }),
    prisma.feedItem.groupBy({
      by: ["kind"],
      _count: { _all: true },
    }),
  ]);

  const feedItemsByDay = groupItemsByCreatedDay(feedItems);

  return (
    <AppShell>
      <div className="page-pad">
        <section className="grid gap-6 xl:grid-cols-[1fr_26rem]">
          <div>
            <p className="section-label">Admin</p>
            <h1 className="mt-3 font-serif text-6xl leading-none tracking-[-0.06em]">
              Crawl operations
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
              Review the central builder pool, canonical de-dupe keys, and the
              feed items imported by day.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <AdminStat label="Pool builders" value={builders.length} />
            <AdminStat label="Recent crawled items" value={feedItems.length} />
          </div>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          <div className="admin-panel">
            <h2 className="font-serif text-3xl">Builder pool by kind</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {Object.values(BuilderKind).map((kind) => (
                <MetricRow
                  key={kind}
                  label={kindLabel(kind)}
                  value={builderKindCounts.find((item) => item.kind === kind)?._count._all ?? 0}
                />
              ))}
            </div>
          </div>
          <div className="admin-panel">
            <h2 className="font-serif text-3xl">Feed items by kind</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {Object.values(FeedItemKind).map((kind) => (
                <MetricRow
                  key={kind}
                  label={feedKindLabel(kind)}
                  value={feedKindCounts.find((item) => item.kind === kind)?._count._all ?? 0}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="section-label">Daily crawl</p>
              <h2 className="mt-2 font-serif text-4xl">Recent imported content</h2>
            </div>
            <span className="rounded-full border border-black/10 bg-white/70 px-4 py-2 text-sm text-[var(--muted-strong)]">
              Last 14 days
            </span>
          </div>

          <div className="mt-5 grid gap-5">
            {feedItemsByDay.map((day) => (
              <article key={day.key} className="admin-panel">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-serif text-3xl">{dateFormatter.format(day.date)}</h3>
                  <span className="kind-pill">{day.items.length} items</span>
                </div>
                <div className="mt-4 divide-y divide-black/10">
                  {day.items.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="grid gap-3 py-4 transition hover:bg-white/60 md:grid-cols-[8rem_1fr_11rem]"
                    >
                      <div>
                        <span className="kind-pill">{feedKindLabel(item.kind)}</span>
                        <p className="mt-2 text-xs text-[var(--muted)]">
                          {timeFormatter.format(item.createdAt)}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <h4 className="truncate font-medium">
                          {item.title || firstLine(item.body)}
                        </h4>
                        <p className="mt-1 truncate text-sm text-[var(--muted)]">
                          {item.builder?.name ?? item.sourceName ?? "Unknown source"}
                        </p>
                      </div>
                      <div className="min-w-0 text-xs text-[var(--muted)]">
                        <p className="truncate font-mono">{item.externalId}</p>
                        <p className="mt-1 truncate font-mono">{item.builder?.canonicalKey}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </article>
            ))}
            {feedItemsByDay.length === 0 ? (
              <div className="admin-panel text-[var(--muted-strong)]">
                No feed items were created in the last 14 days.
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="section-label">Builder pool</p>
              <h2 className="mt-2 font-serif text-4xl">Canonical sources</h2>
            </div>
            <span className="rounded-full border border-black/10 bg-white/70 px-4 py-2 text-sm text-[var(--muted-strong)]">
              Unique by canonicalKey
            </span>
          </div>

          <div className="mt-5 overflow-hidden rounded-[2rem] border border-black/10 bg-white/70">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full border-collapse text-left text-sm">
                <thead className="bg-white/70 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3">Builder</th>
                    <th className="px-4 py-3">Unique id</th>
                    <th className="px-4 py-3">Canonical key</th>
                    <th className="px-4 py-3">Crawl source</th>
                    <th className="px-4 py-3">Counts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {builders.map((builder) => (
                    <tr key={builder.id} className="align-top">
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{builder.name}</span>
                          <span className="kind-pill">{kindLabel(builder.kind)}</span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {builder.handle ? `@${builder.handle}` : builder.sourceUrl}
                        </p>
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-[var(--muted-strong)]">
                        {builder.id}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-[var(--muted-strong)]">
                        {builder.canonicalKey}
                      </td>
                      <td className="max-w-[22rem] px-4 py-4 text-xs text-[var(--muted)]">
                        <p className="truncate">{builder.crawlUrl ?? builder.sourceUrl ?? "No crawl URL"}</p>
                      </td>
                      <td className="px-4 py-4 text-xs text-[var(--muted-strong)]">
                        {builder._count.feedItems} items · {builder._count.subscriptions} subscribers
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function AdminStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-black/10 bg-white/72 p-5">
      <div className="font-serif text-5xl tracking-[-0.06em]">{value}</div>
      <div className="mt-2 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
        {label}
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/62 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{label}</div>
      <div className="mt-2 font-serif text-4xl tracking-[-0.06em]">{value}</div>
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

function kindLabel(kind: BuilderKind) {
  return kind.toLowerCase().replace("_", " ");
}

function feedKindLabel(kind: FeedItemKind) {
  return kind.toLowerCase().replaceAll("_", " ");
}
