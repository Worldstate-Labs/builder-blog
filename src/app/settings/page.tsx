import { redirect } from "next/navigation";
import { KeyRound, ShieldCheck, Terminal, Trash2 } from "lucide-react";
import { createPersonalTokenAction, revokeTokenAction } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;

  const tokens = await prisma.agentToken.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell session={session}>
      <div className="page-pad">
        <div className="page-kicker-row">
          <p className="section-label">Terminal bridge</p>
          <span className="status-chip">
            <KeyRound className="h-3.5 w-3.5" />
            {tokens.filter((token) => !token.revokedAt).length} active
          </span>
        </div>
        <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-6xl">
          Agent login
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted-strong)]">
          The skill uses an agent token to fetch your library, sync personal
          builder items, and write generated digests back to this archive.
        </p>

        {params.token ? (
          <div className="digest-panel mt-8 p-5 text-white md:p-6">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-white/70" />
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-white/56">
                Copy once
              </p>
            </div>
            <code className="mt-4 block break-all rounded-lg bg-black/30 p-4 text-sm">
              {params.token}
            </code>
          </div>
        ) : null}

        <section className="action-panel mt-8 grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Terminal className="h-5 w-5 text-[var(--accent)]" />
              <h2 className="font-serif text-3xl">Terminal access</h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-strong)]">
              Create a token when you need manual CLI access. Revoke old tokens after rotating agents.
            </p>
          </div>
          <form action={createPersonalTokenAction}>
            <FormSubmitButton className="button-dark button-compact" pendingLabel="Creating...">
              Create manual token
            </FormSubmitButton>
          </form>
        </section>

        <section className="mt-10 grid gap-3">
          {tokens.map((token) => (
            <article key={token.id} className="builder-row">
              <div className="min-w-0">
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
                  <FormSubmitButton className="button-light button-compact button-danger gap-2" pendingLabel="Revoking...">
                    <Trash2 className="h-4 w-4" />
                    Revoke
                  </FormSubmitButton>
                </form>
              ) : null}
            </article>
          ))}
          {tokens.length === 0 ? (
            <div className="empty-panel border-dashed text-[var(--muted-strong)]">
              No tokens yet. Create one only when your local agent or terminal skill needs direct access.
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
