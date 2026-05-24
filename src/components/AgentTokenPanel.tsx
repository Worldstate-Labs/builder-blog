"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Copy, Terminal, Trash2 } from "lucide-react";

export type AgentTokenListItem = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export function AgentTokenPanel({
  initialTokens,
}: {
  initialTokens: AgentTokenListItem[];
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copiedSetup, setCopiedSetup] = useState(false);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const activeCount = useMemo(
    () => tokens.filter((token) => !token.revokedAt).length,
    [tokens],
  );

  function createToken() {
    setStatus("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        setNewToken(body.token);
        setTokens((current) => [body.record, ...current]);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Token creation failed");
      }
    });
  }

  function revokeToken(tokenId: string) {
    setStatus("");
    const previousTokens = tokens;
    setTokens((current) =>
      current.map((token) =>
        token.id === tokenId
          ? { ...token, revokedAt: new Date().toISOString() }
          : token,
      ),
    );
    startTransition(async () => {
      try {
        const response = await fetch(`/api/settings/tokens/${tokenId}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
      } catch (error) {
        setTokens(previousTokens);
        setStatus(error instanceof Error ? error.message : "Token revoke failed");
      }
    });
  }

  async function copySetupCommand() {
    setStatus("");
    try {
      const origin = window.location.origin;
      await navigator.clipboard.writeText(`/bin/sh -c "$(curl -fsSL ${origin}/api/skill/bootstrap)"`);
      setCopiedSetup(true);
      window.setTimeout(() => setCopiedSetup(false), 1800);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy setup command");
    }
  }

  return (
    <>
      {newToken ? (
        <div className="digest-panel mt-8 p-5 text-white md:p-6">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-white/56">
            Copy once
          </p>
          <code className="mt-4 block break-all rounded-lg bg-black/30 p-4 text-sm">
            {newToken}
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
            Copy the setup command into your local agent. It downloads the
            latest skill and CLI from this web app, then starts terminal login.
          </p>
        </div>
        <button
          className="button-light button-compact gap-2"
          onClick={copySetupCommand}
          type="button"
        >
          {copiedSetup ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiedSetup ? "Copied" : "Copy setup command"}
        </button>
      </section>

      <section className="action-panel mt-4 grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
        <div className="min-w-0">
          <h2 className="font-serif text-3xl">Manual token</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-strong)]">
            Create a token only when you need direct CLI access without device login.
            Revoke old tokens after rotating agents.
          </p>
        </div>
        <button
          className="button-dark button-compact"
          disabled={isPending}
          onClick={createToken}
          type="button"
        >
          {isPending ? "Creating..." : "Create manual token"}
        </button>
      </section>

      <section className="mt-10 grid gap-3">
        {tokens.map((token) => (
          <article key={token.id} className="builder-row">
            <div className="min-w-0">
              <div className="font-serif text-2xl">{token.name}</div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Created {formatDate(token.createdAt)}
                {token.lastUsedAt ? ` · Last used ${formatDate(token.lastUsedAt)}` : ""}
                {token.revokedAt ? " · Revoked" : ""}
              </p>
            </div>
            {!token.revokedAt ? (
              <button
                className="button-light button-compact button-danger gap-2"
                disabled={isPending}
                onClick={() => revokeToken(token.id)}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
                Revoke
              </button>
            ) : null}
          </article>
        ))}
        {tokens.length === 0 ? (
          <div className="empty-panel border-dashed text-[var(--muted-strong)]">
            No tokens yet. Create one only when your local agent or terminal skill needs direct access.
          </div>
        ) : null}
        <span aria-live="polite">
          {status ? <span className="status-chip status-chip-danger">{status}</span> : null}
        </span>
        <span className="sr-only" aria-live="polite">
          {activeCount} active tokens
        </span>
      </section>
    </>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
