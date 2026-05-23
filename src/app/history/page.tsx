import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function HistoryPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const digests = await prisma.digest.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell>
      <div className="page-pad">
        <p className="section-label">Archive</p>
        <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-6xl">
          Digest history
        </h1>
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
      </div>
    </AppShell>
  );
}
