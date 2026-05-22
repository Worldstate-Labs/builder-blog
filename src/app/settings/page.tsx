import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { createPersonalTokenAction, revokeTokenAction } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const tokens = await prisma.agentToken.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell>
      <div className="page-pad">
        <p className="section-label">Terminal bridge</p>
        <h1 className="mt-3 font-serif text-6xl leading-none tracking-[-0.06em]">
          Agent login
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
          The skill uses an agent token to fetch your subscriptions and sync
          generated digests back to this web archive.
        </p>

        {params.token ? (
          <div className="mt-8 rounded-[2rem] bg-[var(--ink)] p-6 text-white">
            <p className="text-sm uppercase tracking-[0.22em] text-white/50">
              Copy once
            </p>
            <code className="mt-4 block break-all rounded-2xl bg-black/30 p-4 text-sm">
              {params.token}
            </code>
          </div>
        ) : null}

        <form action={createPersonalTokenAction} className="mt-8">
          <button className="button-dark" type="submit">
            Create manual token
          </button>
        </form>

        <section className="mt-10 grid gap-3">
          {tokens.map((token) => (
            <article key={token.id} className="builder-row">
              <div>
                <div className="font-serif text-2xl">{token.name}</div>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Created {token.createdAt.toLocaleString()}
                  {token.lastUsedAt ? ` · Last used ${token.lastUsedAt.toLocaleString()}` : ""}
                  {token.revokedAt ? ` · Revoked` : ""}
                </p>
              </div>
              {!token.revokedAt ? (
                <form action={revokeTokenAction}>
                  <input type="hidden" name="tokenId" value={token.id} />
                  <button className="button-light" type="submit">
                    Revoke
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
