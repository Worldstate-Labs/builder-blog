import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
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
        <h1 className="mt-3 font-serif text-6xl leading-none tracking-[-0.06em]">
          Digest history
        </h1>
        <div className="mt-10 space-y-6">
          {digests.map((digest) => (
            <article id={digest.id} key={digest.id} className="digest-card">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]">
                <span>{digest.createdAt.toLocaleString()}</span>
                <span>{digest.itemCount} source items · {digest.language}</span>
              </div>
              <h2 className="mt-4 font-serif text-4xl">{digest.title}</h2>
              <pre className="mt-6 whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--muted-strong)]">
                {digest.content}
              </pre>
            </article>
          ))}
          {digests.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-black/20 p-10">
              No historical digest yet. Connect the terminal skill from Agent
              Login, then run a digest sync.
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
