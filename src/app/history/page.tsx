import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const historyPageSize = 20;

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const skip = (page - 1) * historyPageSize;

  const [digests, digestCount] = await Promise.all([
    prisma.digest.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      skip,
      take: historyPageSize,
    }),
    prisma.digest.count({
      where: { userId: session.user.id },
    }),
  ]);
  const visibleStart = digestCount === 0 ? 0 : skip + 1;
  const visibleEnd = Math.min(skip + digests.length, digestCount);

  return (
    <AppShell session={session}>
      <div className="page-pad">
        <p className="section-label">Archive</p>
        <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-6xl">
          Digest history
        </h1>
        <p className="mt-5 text-sm text-[var(--muted)]">
          Showing {visibleStart}-{visibleEnd} of {digestCount} digests.
        </p>
        <div className="item-list mt-10">
          {digests.map((digest, index) => (
            <article id={digest.id} key={digest.id} className="digest-card digest-card-compact">
              <details className="item-disclosure" open={index === 0}>
                <summary className="item-summary">
                  <span className="min-w-0">
                    <span className="item-kicker">
                      <span>{digest.createdAt.toLocaleString()}</span>
                      <span>
                        {digest.itemCount} items · {digest.language}
                      </span>
                    </span>
                    <span className="item-title">{digest.title}</span>
                  </span>
                  <span className="item-summary-action">
                    <BookOpen className="h-3.5 w-3.5" />
                    Read
                  </span>
                </summary>
                <pre className="item-details whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--muted-strong)]">
                  {digest.content}
                </pre>
              </details>
            </article>
          ))}
          {digests.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--line)] p-6 md:p-10">
              No historical digest yet. Connect the terminal skill from Agent
              Login, then run a digest sync.
            </div>
          ) : null}
        </div>
        {digestCount > historyPageSize ? (
          <nav className="mt-8 flex flex-wrap gap-3" aria-label="Digest history pagination">
            <Link
              aria-disabled={page === 1}
              className={`button-light ${page === 1 ? "pointer-events-none opacity-45" : ""}`}
              href={`/history?page=${Math.max(1, page - 1)}`}
            >
              Newer
            </Link>
            <Link
              aria-disabled={skip + digests.length >= digestCount}
              className={`button-light ${
                skip + digests.length >= digestCount ? "pointer-events-none opacity-45" : ""
              }`}
              href={`/history?page=${page + 1}`}
            >
              Older
            </Link>
          </nav>
        ) : null}
      </div>
    </AppShell>
  );
}
