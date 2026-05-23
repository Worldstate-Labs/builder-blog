import Link from "next/link";
import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { Archive, CheckCircle2, Clock3 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");

  const [todayDigest, recentDigests, digestCount] = await Promise.all([
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
    prisma.digest.count({
      where: { userId: session.user.id },
    }),
  ]);

  return (
    <AppShell session={session}>
      <div className="page-pad">
        <section className="grid gap-6 xl:grid-cols-[1fr_22rem]">
          <div>
            <p className="section-label">Personal digest</p>
            <h1 className="mt-3 max-w-4xl font-serif text-4xl font-semibold leading-tight md:text-6xl">
              Today&apos;s feed, synced and archived.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
              This page only shows generated digest feed entries. Library
              controls and crawled source content live outside Today.
            </p>
          </div>
          <div className="stats-panel">
            <Stat
              icon={todayDigest ? CheckCircle2 : Clock3}
              label="Today"
              value={todayDigest ? "Synced" : "Empty"}
            />
            <Stat icon={Archive} label="Archive entries" value={digestCount} />
          </div>
        </section>

        <section className="mt-10 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <article className="min-w-0 rounded-lg bg-[var(--ink)] p-5 text-white shadow-xl shadow-black/10 md:p-7">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-serif text-3xl">Today&apos;s digest</h2>
              {todayDigest ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-xs uppercase tracking-[0.16em]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Synced
                </span>
              ) : null}
            </div>
            {todayDigest ? (
              <>
                <h3 className="mt-6 font-serif text-4xl leading-tight">
                  {todayDigest.title}
                </h3>
                <pre className="mt-6 whitespace-pre-wrap break-words font-sans text-sm leading-7 text-white/75">
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

          <aside className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-5 md:p-6">
            <h2 className="font-serif text-3xl">Recent feed</h2>
            <div className="mt-5 space-y-4">
              {recentDigests.map((digest) => (
                <Link
                  key={digest.id}
                  href={`/history#${digest.id}`}
                  className="block rounded-lg border border-[var(--line)] p-4 transition hover:bg-[var(--paper)]"
                >
                  <div className="font-medium">{digest.title}</div>
                  <div className="mt-1 text-sm text-[var(--muted)]">
                    {digest.itemCount} items · {digest.createdAt.toLocaleDateString()}
                  </div>
                </Link>
              ))}
              {recentDigests.length === 0 ? (
                <p className="text-sm leading-6 text-[var(--muted)]">
                  Digests synced by the skill will appear here.
                </p>
              ) : null}
            </div>
            <Link className="button-light button-compact mt-5 gap-2" href="/history">
              <Archive className="h-4 w-4" />
              Open history
            </Link>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
}) {
  return (
    <div className="stat-card">
      <Icon className="stat-card-icon" />
      <div className="min-w-0">
        <div className="stat-card-value">{value}</div>
        <div className="stat-card-label">{label}</div>
      </div>
    </div>
  );
}
