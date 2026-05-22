import { BuilderKind } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import {
  addBuilderAction,
  subscribeAllDefaultBuildersAction,
  subscribeBuilderAction,
  unsubscribeBuilderAction,
} from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function BuildersPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const [builders, subscriptions] = await Promise.all([
    prisma.builder.findMany({
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      include: { _count: { select: { subscriptions: true, feedItems: true } } },
    }),
    prisma.subscription.findMany({
      where: { userId: session.user.id },
      select: { builderId: true },
    }),
  ]);
  const subscribed = new Set(subscriptions.map((subscription) => subscription.builderId));

  return (
    <AppShell>
      <div className="page-pad">
        <div className="grid gap-8 xl:grid-cols-[1fr_24rem]">
          <section>
            <p className="section-label">Pool</p>
            <h1 className="mt-3 font-serif text-6xl leading-none tracking-[-0.06em]">
              Builder subscriptions
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
              Add a builder once to the central pool. If the same handle or URL
              already exists, the app only creates your subscription.
            </p>
          </section>
          <section className="rounded-[2rem] border border-black/10 bg-white/72 p-6">
            <h2 className="font-serif text-3xl">Add builder</h2>
            <form action={addBuilderAction} className="mt-5 grid gap-3">
              <input className="input" name="name" placeholder="Name, e.g. Linus Lee" required />
              <input className="input" name="handle" placeholder="X handle, e.g. thesephist" />
              <input className="input" name="sourceUrl" placeholder="Blog / podcast / website URL" />
              <button className="button-dark" type="submit">
                Add and subscribe
              </button>
            </form>
            <form action={subscribeAllDefaultBuildersAction} className="mt-3">
              <button className="button-light w-full" type="submit">
                Subscribe to default X pool
              </button>
            </form>
          </section>
        </div>

        <section className="mt-10 grid gap-4">
          {builders.map((builder) => {
            const isSubscribed = subscribed.has(builder.id);
            return (
              <article key={builder.id} className="builder-row">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-serif text-2xl">{builder.name}</h2>
                    <span className="kind-pill">{kindLabel(builder.kind)}</span>
                    {isSubscribed ? <span className="sub-pill">Subscribed</span> : null}
                  </div>
                  <p className="mt-2 truncate text-sm text-[var(--muted)]">
                    {builder.handle ? `@${builder.handle}` : builder.sourceUrl}
                  </p>
                  <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                    {builder._count.subscriptions} subscribers · {builder._count.feedItems} items
                  </p>
                </div>
                <form action={isSubscribed ? unsubscribeBuilderAction : subscribeBuilderAction}>
                  <input type="hidden" name="builderId" value={builder.id} />
                  <button className={isSubscribed ? "button-light" : "button-dark"} type="submit">
                    {isSubscribed ? "Unsubscribe" : "Subscribe"}
                  </button>
                </form>
              </article>
            );
          })}
        </section>
      </div>
    </AppShell>
  );
}

function kindLabel(kind: BuilderKind) {
  return kind.toLowerCase().replace("_", " ");
}
