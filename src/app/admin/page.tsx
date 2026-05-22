import { BuilderKind, BuilderScope, FeedItemKind } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { addCentralBuilderAction, deleteCentralBuilderAction } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { isAdminEmail } from "@/lib/admin";
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
  if (!isAdminEmail(session.user.email)) redirect("/dashboard?error=admin-required");

  const since = new Date(new Date().getTime() - 14 * 24 * 60 * 60 * 1000);
  const [builders, personalBuilderCount, feedItems, builderKindCounts, feedKindCounts] = await Promise.all([
    prisma.builder.findMany({
      where: { scope: BuilderScope.CENTRAL },
      include: { _count: { select: { subscriptions: true, feedItems: true } } },
      orderBy: [{ kind: "asc" }, { updatedAt: "desc" }, { name: "asc" }],
    }),
    prisma.builder.count({ where: { scope: BuilderScope.PERSONAL } }),
    prisma.feedItem.findMany({
      where: { createdAt: { gte: since }, builder: { scope: BuilderScope.CENTRAL } },
      include: { builder: true },
      orderBy: [{ createdAt: "desc" }, { publishedAt: "desc" }],
      take: 160,
    }),
    prisma.builder.groupBy({
      by: ["kind"],
      where: { scope: BuilderScope.CENTRAL },
      _count: { _all: true },
    }),
    prisma.feedItem.groupBy({
      by: ["kind"],
      where: { builder: { scope: BuilderScope.CENTRAL } },
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
            <AdminStat label="Personal builders" value={personalBuilderCount} />
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
          <div className="admin-panel mb-5">
            <h2 className="font-serif text-3xl">Add central builder</h2>
            <form action={addCentralBuilderAction} className="mt-5 grid gap-3 md:grid-cols-[1fr_12rem_1fr_1fr_auto]">
              <input className="input" name="name" placeholder="Name" required />
              <select className="input" name="kind" defaultValue={BuilderKind.X}>
                <option value={BuilderKind.X}>X / Twitter</option>
                <option value={BuilderKind.BLOG}>Blog index</option>
                <option value={BuilderKind.PODCAST}>Podcast RSS</option>
                <option value={BuilderKind.WEBSITE}>Website</option>
              </select>
              <input className="input" name="handle" placeholder="X handle" />
              <input className="input" name="sourceUrl" placeholder="URL or RSS" />
              <button className="button-dark" type="submit">
                Add
              </button>
            </form>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="section-label">Builder pool</p>
              <h2 className="mt-2 font-serif text-4xl">Canonical sources</h2>
            </div>
            <span className="rounded-full border border-black/10 bg-white/70 px-4 py-2 text-sm text-[var(--muted-strong)]">
              {builders.length} builders · unique by canonicalKey
            </span>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {builders.map((builder) => (
              <article key={builder.id} className="admin-panel">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-serif text-2xl">{builder.name}</h3>
                      <span className="kind-pill">{kindLabel(builder.kind)}</span>
                    </div>
                    <p className="mt-2 truncate text-sm text-[var(--muted)]">
                      {builder.handle ? `@${builder.handle}` : builder.sourceUrl}
                    </p>
                  </div>
                  <div className="text-right text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                    {builder._count.feedItems} items
                    <br />
                    {builder._count.subscriptions} subscribers
                    <form action={deleteCentralBuilderAction} className="mt-3">
                      <input type="hidden" name="builderId" value={builder.id} />
                      <button className="button-light" type="submit">
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
                <dl className="mt-4 grid gap-3 text-xs">
                  <div>
                    <dt className="uppercase tracking-[0.16em] text-[var(--muted)]">Unique id</dt>
                    <dd className="mt-1 break-all font-mono text-[var(--muted-strong)]">
                      {builder.id}
                    </dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.16em] text-[var(--muted)]">Canonical key</dt>
                    <dd className="mt-1 break-all font-mono text-[var(--muted-strong)]">
                      {builder.canonicalKey}
                    </dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.16em] text-[var(--muted)]">Crawl source</dt>
                    <dd className="mt-1 break-all text-[var(--muted-strong)]">
                      {builder.crawlUrl ?? builder.sourceUrl ?? "No crawl URL"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
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
              <details key={day.key} className="admin-panel" open>
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                  <h3 className="font-serif text-3xl">{dateFormatter.format(day.date)}</h3>
                  <span className="kind-pill">{day.items.length} items</span>
                </summary>
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
              </details>
            ))}
            {feedItemsByDay.length === 0 ? (
              <div className="admin-panel text-[var(--muted-strong)]">
                No feed items were created in the last 14 days.
              </div>
            ) : null}
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
