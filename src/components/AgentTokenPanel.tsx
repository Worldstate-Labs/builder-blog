"use client";

import { useMemo, useState, useTransition } from "react";
import { KeyRound, Plus } from "lucide-react";

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
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
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

  const bootstrapCommand =
    '/bin/sh -c "$(curl -fsSL https://followbrief.app/api/skill/bootstrap)"';

  async function copyBootstrap() {
    try {
      await navigator.clipboard.writeText(bootstrapCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setStatus("Could not copy bootstrap command");
    }
  }

  return (
    <section className="fb-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="fb-section-heading">Agent tokens</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted-strong)]">
            Long-lived tokens for the terminal skill. Treat them like passwords.
          </p>
        </div>
        <button
          className="fb-btn dark compact"
          disabled={isPending}
          onClick={createToken}
          type="button"
        >
          <Plus aria-hidden="true" />
          {isPending ? "Creating..." : "New token"}
        </button>
      </div>

      <div className="fb-code-block mt-4">
        <code>{bootstrapCommand}</code>
        <button
          className="fb-code-block-copy"
          onClick={copyBootstrap}
          type="button"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {newToken ? (
        <div className="mt-4 rounded-[10px] border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
            Copy once · This token will not be shown again
          </p>
          <code className="mono mt-2 block break-all text-[12px] text-[var(--ink)]">
            {newToken}
          </code>
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)]">
        {tokens.map((token) => (
          <div
            key={token.id}
            className="fb-token-row"
            style={{ opacity: token.revokedAt ? 0.55 : 1 }}
          >
            <span className="fb-src-icon" style={{ width: "2rem", height: "2rem" }}>
              <KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold">{token.name}</div>
              <div className="fb-src-meta">
                <span>Created {formatDate(token.createdAt)}</span>
                {token.lastUsedAt ? (
                  <>
                    <span>·</span>
                    <span>Last used {formatDate(token.lastUsedAt)}</span>
                  </>
                ) : null}
                {token.revokedAt ? (
                  <>
                    <span>·</span>
                    <span>Revoked</span>
                  </>
                ) : null}
              </div>
            </div>
            {token.revokedAt ? (
              <span className="fb-kind-pill">revoked</span>
            ) : (
              <button
                className="fb-btn ghost compact"
                disabled={isPending}
                onClick={() => revokeToken(token.id)}
                type="button"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
        {tokens.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-[var(--muted-strong)]">
            No tokens yet. Create one when your local agent or terminal skill needs direct access.
          </div>
        ) : null}
      </div>

      <span aria-live="polite" className="mt-2 block">
        {status ? <span className="text-[12px] text-[var(--danger)]">{status}</span> : null}
      </span>
      <span className="sr-only" aria-live="polite">
        {activeCount} active tokens
      </span>
    </section>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
