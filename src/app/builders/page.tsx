import { BuilderKind, BuilderScope } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function BuildersPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const [centralBuilders, personalBuilders] = await Promise.all([
    prisma.builder.findMany({
      where: { scope: BuilderScope.CENTRAL },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      include: { _count: { select: { subscriptions: true, feedItems: true } } },
    }),
    prisma.builder.findMany({
      where: { scope: BuilderScope.PERSONAL, ownerUserId: session.user.id },
      orderBy: [{ kind: "asc" }, { updatedAt: "desc" }, { name: "asc" }],
      include: { _count: { select: { feedItems: true } } },
    }),
  ]);

  return (
    <AppShell>
      <div className="page-pad">
        <section>
          <p className="section-label">Library</p>
          <h1 className="mt-3 font-serif text-6xl leading-none tracking-[-0.06em]">
            Builder library
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
            Central builders are included for every account. Personal builders
            are synced by your own agent token.
          </p>
        </section>

        <section className="mt-10 grid gap-4">
          <LibrarySection title="Central builders" scope={BuilderScope.CENTRAL}>
            {centralBuilders.map((builder) => (
              <article key={builder.id} className="builder-row">
                <div className="min-w-0">
                  <BuilderTitle kind={builder.kind} name={builder.name} scope="Included" />
                  <BuilderSource handle={builder.handle} sourceUrl={builder.sourceUrl} />
                  <BuilderMeta label={`${builder._count.feedItems} items`} />
                </div>
              </article>
            ))}
          </LibrarySection>

          <LibrarySection title="Personal builders" scope={BuilderScope.PERSONAL}>
            {personalBuilders.map((builder) => (
              <article key={builder.id} className="builder-row">
                <div className="min-w-0">
                  <BuilderTitle kind={builder.kind} name={builder.name} scope="Personal" />
                  <BuilderSource handle={builder.handle} sourceUrl={builder.sourceUrl} />
                  <BuilderMeta label={`${builder._count.feedItems} synced items`} />
                </div>
              </article>
            ))}
            {personalBuilders.length === 0 ? (
              <div className="builder-row text-[var(--muted-strong)]">
                No personal builders synced yet.
              </div>
            ) : null}
          </LibrarySection>
        </section>
      </div>
    </AppShell>
  );
}

function kindLabel(kind: BuilderKind) {
  return kind.toLowerCase().replace("_", " ");
}

function LibrarySection({
  title,
  scope,
  children,
}: {
  title: string;
  scope: BuilderScope;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-4xl">{title}</h2>
        <span className="kind-pill">{scope.toLowerCase()}</span>
      </div>
      {children}
    </section>
  );
}

function BuilderTitle({
  kind,
  name,
  scope,
}: {
  kind: BuilderKind;
  name: string;
  scope: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-serif text-2xl">{name}</h3>
      <span className="kind-pill">{kindLabel(kind)}</span>
      <span className="sub-pill">{scope}</span>
    </div>
  );
}

function BuilderSource({
  handle,
  sourceUrl,
}: {
  handle: string | null;
  sourceUrl: string | null;
}) {
  return (
    <p className="mt-2 truncate text-sm text-[var(--muted)]">
      {handle ? `@${handle}` : sourceUrl}
    </p>
  );
}

function BuilderMeta({ label }: { label: string }) {
  return (
    <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
      {label}
    </p>
  );
}
