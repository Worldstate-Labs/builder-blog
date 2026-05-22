import { BuilderKind, BuilderScope } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  addBuilderToLibraryAction,
  removeBuilderFromLibraryAction,
  subscribeAllLibraryBuildersAction,
  subscribeBuilderAction,
  unsubscribeBuilderAction,
} from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { authOptions } from "@/lib/auth";
import { ensureDefaultBuilderPool } from "@/lib/builder-pool";
import { prisma } from "@/lib/prisma";

type BuilderWithCount = {
  id: string;
  scope: BuilderScope;
  kind: BuilderKind;
  name: string;
  handle: string | null;
  sourceUrl: string | null;
  crawlUrl: string | null;
  canonicalKey: string;
  _count: { feedItems: number };
};

export default async function BuildersPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  await ensureDefaultBuilderPool(session.user.id);

  const [poolEntries, subscriptions, removedCentralBuilders] = await Promise.all([
    prisma.builderPoolEntry.findMany({
      where: { userId: session.user.id, removedAt: null },
      include: {
        builder: {
          include: { _count: { select: { feedItems: true } } },
        },
      },
    }),
    prisma.subscription.findMany({
      where: { userId: session.user.id },
      select: { builderId: true },
    }),
    prisma.builder.findMany({
      where: {
        scope: BuilderScope.CENTRAL,
        poolEntries: {
          some: {
            userId: session.user.id,
            removedAt: { not: null },
          },
        },
      },
      include: { _count: { select: { feedItems: true } } },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
  ]);

  const subscribed = new Set(subscriptions.map((subscription) => subscription.builderId));
  const poolBuilders = poolEntries
    .map((entry) => entry.builder)
    .sort(builderSort);
  const centralBuilders = poolBuilders.filter((builder) => builder.scope === BuilderScope.CENTRAL);
  const personalBuilders = poolBuilders.filter((builder) => builder.scope === BuilderScope.PERSONAL);
  const subscribedCount = poolBuilders.filter((builder) => subscribed.has(builder.id)).length;

  return (
    <AppShell>
      <div className="page-pad">
        <section className="grid gap-6 xl:grid-cols-[1fr_24rem]">
          <div>
            <p className="section-label">Library</p>
            <h1 className="mt-3 font-serif text-6xl leading-none tracking-[-0.06em]">
              Builder pool
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
              In library means available to you. Subscribed means included in
              your periodic digest. Central builders are crawled by the web app;
              personal builders are synced by your own agent.
            </p>
          </div>
          <div className="stats-panel">
            <Stat label="In library" value={poolBuilders.length} />
            <Stat label="Subscribed" value={subscribedCount} />
            <Stat label="Personal" value={personalBuilders.length} />
          </div>
        </section>

        <section className="mt-8 rounded-[2rem] border border-black/10 bg-white/72 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-serif text-3xl">Digest subscription</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-strong)]">
                Toggle Subscribe on any builder in your pool. The digest skill
                only receives subscribed builders and their feed items.
              </p>
            </div>
            <form action={subscribeAllLibraryBuildersAction}>
              <button className="button-dark" type="submit">
                Subscribe all in library
              </button>
            </form>
          </div>
        </section>

        <section className="mt-10 grid gap-8">
          <LibrarySection
            title="Central library"
            detail="Default pool, crawled once by Builder Blog"
            scope={BuilderScope.CENTRAL}
          >
            {centralBuilders.map((builder) => (
              <BuilderCard
                key={builder.id}
                builder={builder}
                subscribed={subscribed.has(builder.id)}
                crawlLabel="Webapp crawled"
              />
            ))}
          </LibrarySection>

          <LibrarySection
            title="Personal library"
            detail="Synced by your agent with your own API keys or subscriptions"
            scope={BuilderScope.PERSONAL}
          >
            {personalBuilders.map((builder) => (
              <BuilderCard
                key={builder.id}
                builder={builder}
                subscribed={subscribed.has(builder.id)}
                crawlLabel="Agent synced"
              />
            ))}
            {personalBuilders.length === 0 ? (
              <div className="builder-row text-[var(--muted-strong)]">
                No personal builders yet. Use the skill command
                <code className="mx-2 rounded-xl bg-black/5 px-2 py-1">sync-builders</code>
                after your agent crawls private or user-paid sources.
              </div>
            ) : null}
          </LibrarySection>

          {removedCentralBuilders.length > 0 ? (
            <LibrarySection
              title="Available central builders"
              detail="Removed from your pool; add back any time"
              scope={BuilderScope.CENTRAL}
            >
              {removedCentralBuilders.map((builder) => (
                <article key={builder.id} className="builder-row">
                  <BuilderInfo builder={builder} status="Available" crawlLabel="Webapp crawled" />
                  <form action={addBuilderToLibraryAction}>
                    <input type="hidden" name="builderId" value={builder.id} />
                    <button className="button-dark" type="submit">
                      Add to library
                    </button>
                  </form>
                </article>
              ))}
            </LibrarySection>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

function BuilderCard({
  builder,
  subscribed,
  crawlLabel,
}: {
  builder: BuilderWithCount;
  subscribed: boolean;
  crawlLabel: string;
}) {
  return (
    <article className="builder-row">
      <BuilderInfo
        builder={builder}
        status={subscribed ? "Subscribed" : "In library"}
        crawlLabel={crawlLabel}
      />
      <div className="flex flex-wrap gap-2">
        <form action={subscribed ? unsubscribeBuilderAction : subscribeBuilderAction}>
          <input type="hidden" name="builderId" value={builder.id} />
          <button className={subscribed ? "button-light" : "button-dark"} type="submit">
            {subscribed ? "Unsubscribe" : "Subscribe"}
          </button>
        </form>
        <form action={removeBuilderFromLibraryAction}>
          <input type="hidden" name="builderId" value={builder.id} />
          <button className="button-light" type="submit">
            Remove from library
          </button>
        </form>
      </div>
    </article>
  );
}

function BuilderInfo({
  builder,
  status,
  crawlLabel,
}: {
  builder: BuilderWithCount;
  status: string;
  crawlLabel: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-2xl">{builder.name}</h3>
        <span className="kind-pill">{kindLabel(builder.kind)}</span>
        <span className="sub-pill">{status}</span>
      </div>
      <p className="mt-2 truncate text-sm text-[var(--muted)]">
        {builder.handle ? `@${builder.handle}` : builder.sourceUrl}
      </p>
      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
        {crawlLabel} · {builder._count.feedItems} items · {builder.canonicalKey}
      </p>
    </div>
  );
}

function LibrarySection({
  title,
  detail,
  scope,
  children,
}: {
  title: string;
  detail: string;
  scope: BuilderScope;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-4xl">{title}</h2>
          <p className="mt-1 text-sm text-[var(--muted-strong)]">{detail}</p>
        </div>
        <span className="kind-pill">{scope.toLowerCase()}</span>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-black/10 bg-white/72 p-5">
      <div className="font-serif text-5xl tracking-[-0.06em]">{value}</div>
      <div className="mt-2 text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
        {label}
      </div>
    </div>
  );
}

function kindLabel(kind: BuilderKind) {
  return kind.toLowerCase().replace("_", " ");
}

function builderSort(a: BuilderWithCount, b: BuilderWithCount) {
  return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
}
