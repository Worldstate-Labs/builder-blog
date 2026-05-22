import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { FeedCard } from "@/components/FeedCard";
import { authOptions } from "@/lib/auth";
import { activePoolBuilderIds } from "@/lib/builder-pool";
import { subscriptionBuilderIdsInPool } from "@/lib/digest-library";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const poolBuilderIds = await activePoolBuilderIds(session.user.id);
  const [poolBuilders, subscriptions] = await Promise.all([
    prisma.builder.findMany({
      where: { id: { in: poolBuilderIds } },
      select: { id: true, scope: true },
    }),
    prisma.subscription.findMany({
      where: { userId: session.user.id, builderId: { in: poolBuilderIds } },
      select: { builderId: true },
    }),
  ]);
  const subscribedBuilderIds = subscriptionBuilderIdsInPool(
    poolBuilderIds,
    subscriptions.map((subscription) => subscription.builderId),
  );

  const [todayDigest, recentDigests, feedItems] = await Promise.all([
    prisma.digest.findFirst({
      where: {
        userId: session.user.id,
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.digest.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.feedItem.findMany({
      where: { builderId: { in: subscribedBuilderIds } },
      include: { builder: true },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 8,
    }),
  ]);

  return (
    <AppShell>
      <div className="page-pad">
        <section className="grid gap-6 xl:grid-cols-[1fr_22rem]">
          <div>
            <p className="section-label">Personal digest</p>
            <h1 className="mt-3 max-w-4xl font-serif text-4xl font-semibold leading-tight md:text-6xl">
              Your builder signal, archived.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
              The central pool crawls once. Your agent can sync personal
              builder updates into the same archive.
            </p>
          </div>
          <div className="stats-panel">
            <Stat label="In library" value={poolBuilders.length} />
            <Stat label="Subscribed" value={subscriptions.length} />
            <Stat label="Recent items" value={feedItems.length} />
          </div>
        </section>

        <section className="mt-10 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-lg bg-[var(--ink)] p-5 text-white shadow-xl shadow-black/10 md:p-7">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-serif text-3xl">Today&apos;s digest</h2>
              {todayDigest ? (
                <span className="rounded-full bg-white/12 px-3 py-1 text-xs uppercase tracking-[0.2em]">
                  Synced
                </span>
              ) : null}
            </div>
            {todayDigest ? (
              <>
                <h3 className="mt-6 font-serif text-4xl leading-tight">
                  {todayDigest.title}
                </h3>
                <pre className="mt-6 whitespace-pre-wrap font-sans text-sm leading-7 text-white/75">
                  {todayDigest.content}
                </pre>
              </>
            ) : (
              <div className="mt-8 rounded-lg border border-dashed border-white/20 p-6 text-white/68">
                No synced digest today. Run the skill from your terminal or agent:
                <code className="mt-3 block rounded-lg bg-black/30 p-4 text-sm text-white">
                  builder-digest prepare | agent summarizes | builder-digest sync --file digest.md
                </code>
              </div>
            )}
          </article>

          <aside className="rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-5 md:p-6">
            <h2 className="font-serif text-3xl">Recent archive</h2>
            <div className="mt-5 space-y-4">
              {recentDigests.map((digest) => (
                <a
                  key={digest.id}
                  href={`/history#${digest.id}`}
                  className="block rounded-lg border border-[var(--line)] p-4 transition hover:bg-[var(--paper-strong)]"
                >
                  <div className="font-medium">{digest.title}</div>
                  <div className="mt-1 text-sm text-[var(--muted)]">
                    {digest.itemCount} items · {digest.createdAt.toLocaleDateString()}
                  </div>
                </a>
              ))}
              {recentDigests.length === 0 ? (
                <p className="text-sm leading-6 text-[var(--muted)]">
                  Digests synced by the skill will appear here.
                </p>
              ) : null}
            </div>
          </aside>
        </section>

        <section className="mt-12">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="section-label">Subscribed feed</p>
              <h2 className="mt-2 font-serif text-4xl">Latest digest inputs</h2>
            </div>
            <a className="button-light" href="/builders">
              Manage builders
            </a>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {feedItems.map((item) => (
              <FeedCard
                key={item.id}
                title={item.title}
                source={item.builder?.name ?? item.sourceName}
                body={item.body}
                url={item.url}
                date={item.publishedAt ?? item.createdAt}
              />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-5">
      <div className="font-serif text-4xl font-semibold">{value}</div>
      <div className="mt-2 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
        {label}
      </div>
    </div>
  );
}
