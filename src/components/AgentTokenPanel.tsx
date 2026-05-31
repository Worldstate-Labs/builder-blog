"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus } from "lucide-react";

export type AgentTokenListItem = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastIp: string | null;
  lastUserAgent: string | null;
  lastHostname: string | null;
  lastPlatform: string | null;
  lastUser: string | null;
  revokedAt: string | null;
};

function prettyOs(platformString: string | null): string {
  if (!platformString) return "";
  const lower = platformString.toLowerCase();
  if (lower.startsWith("darwin")) {
    // "darwin 24.3.0" → "macOS 14"
    const release = lower.match(/(\d+)/)?.[0];
    const macMajor = release ? Number(release) - 9 : null;
    return macMajor && macMajor > 9 ? `macOS ${macMajor}` : "macOS";
  }
  if (lower.startsWith("linux")) return "Linux";
  if (lower.startsWith("win")) return "Windows";
  if (lower.startsWith("freebsd")) return "FreeBSD";
  return platformString.split(/\s+/)[0]!.slice(0, 32);
}

/**
 * Build a short human-readable machine label from the token's recorded
 * fields. Prefers CLI-reported identity (hostname + user + OS) and
 * falls back to parsing the user-agent string for tokens created
 * before machine headers existed.
 */
export function describeMachine(token: AgentTokenListItem): string {
  const host = token.lastHostname?.replace(/\.local$/, "") ?? null;
  const user = token.lastUser ?? null;
  const os = prettyOs(token.lastPlatform);
  if (host || user || os) {
    const parts: string[] = [];
    if (host) parts.push(host);
    if (user && user !== host) parts.push(user);
    if (os) parts.push(os);
    return parts.join(" · ");
  }
  return summarizeUserAgent(token.lastUserAgent);
}

function summarizeUserAgent(ua: string | null): string {
  if (!ua) return "unknown machine";
  const lower = ua.toLowerCase();
  let os = "";
  if (lower.includes("mac")) os = "Mac";
  else if (lower.includes("windows")) os = "Windows";
  else if (lower.includes("linux")) os = "Linux";

  let client = "";
  if (lower.includes("claude") || lower.includes("claudecode")) client = "Claude Code";
  else if (lower.includes("codex")) client = "Codex";
  else if (lower.includes("curl")) client = "curl";
  else if (lower.includes("node")) client = "Node";

  const parts = [os, client].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return ua.slice(0, 60);
}

export function AgentTokenPanel({
  initialTokens,
}: {
  initialTokens: AgentTokenListItem[];
}) {
  const router = useRouter();
  const [tokenName, setTokenName] = useState("");
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Revoke confirm dialog state
  const [revokeTarget, setRevokeTarget] = useState<AgentTokenListItem | null>(null);
  const revokeDialogRef = useRef<HTMLDialogElement>(null);
  const initialTokenSignature = useMemo(
    () =>
      initialTokens
        .map((token) =>
          [
            token.id,
            token.createdAt,
            token.lastUsedAt,
            token.lastHostname,
            token.lastPlatform,
            token.lastUser,
            token.revokedAt,
          ].join(":"),
        )
        .join("|"),
    [initialTokens],
  );
  const [tokenState, setTokenState] = useState<{
    key: string;
    tokens: AgentTokenListItem[];
  }>({
    key: initialTokenSignature,
    tokens: initialTokens,
  });
  const tokens =
    tokenState.key === initialTokenSignature ? tokenState.tokens : initialTokens;

  function setTokens(
    updater:
      | AgentTokenListItem[]
      | ((current: AgentTokenListItem[]) => AgentTokenListItem[]),
  ) {
    setTokenState((current) => {
      const currentTokens =
        current.key === initialTokenSignature ? current.tokens : initialTokens;
      return {
        key: initialTokenSignature,
        tokens:
          typeof updater === "function"
            ? updater(currentTokens)
            : updater,
      };
    });
  }

  const activeCount = useMemo(
    () => tokens.filter((token) => !token.revokedAt).length,
    [tokens],
  );
  const visibleTokens = useMemo(
    () => tokens.filter((token) => !token.revokedAt).slice(0, 5),
    [tokens],
  );
  const visibleTokenIds = useMemo(
    () => new Set(visibleTokens.map((token) => token.id)),
    [visibleTokens],
  );
  const hiddenTokens = useMemo(
    () => tokens.filter((token) => !visibleTokenIds.has(token.id)),
    [tokens, visibleTokenIds],
  );

  function openCreateDialog() {
    setStatus("");
    setCreateOpen(true);
    createDialogRef.current?.showModal();
    // Focus the input after the dialog has rendered.
    window.setTimeout(() => createInputRef.current?.focus(), 0);
  }

  function closeCreateDialog() {
    createDialogRef.current?.close();
    setCreateOpen(false);
    setTokenName("");
  }

  function submitCreate() {
    const name = tokenName.trim();
    if (!name) {
      setStatus("Give the token a name first.");
      return;
    }
    setStatus("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        setTokens((current) => [body.record, ...current]);
        closeCreateDialog();
        // Refresh server components on other routes (/builders, /dashboard)
        // so their cached token lists pick up the new row — otherwise the
        // copy-prompt picker on those pages renders a stale list.
        router.refresh();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Token creation failed");
      }
    });
  }

  function openRevokeDialog(token: AgentTokenListItem) {
    setRevokeTarget(token);
    revokeDialogRef.current?.showModal();
  }

  function closeRevokeDialog() {
    revokeDialogRef.current?.close();
    setRevokeTarget(null);
  }

  function confirmRevoke() {
    if (!revokeTarget) return;
    const tokenId = revokeTarget.id;
    closeRevokeDialog();
    setStatus("");
    const previousTokens = tokens;
    // Optimistically remove the row.
    setTokens((current) => current.filter((token) => token.id !== tokenId));
    startTransition(async () => {
      try {
        const response = await fetch(`/api/settings/tokens/${tokenId}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        router.refresh();
      } catch (error) {
        setTokens(previousTokens);
        setStatus(error instanceof Error ? error.message : "Token revoke failed");
      }
    });
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
          onClick={openCreateDialog}
          type="button"
        >
          <Plus aria-hidden="true" />
          New token
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)]">
        {visibleTokens.map((token) => (
          <TokenRow
            key={token.id}
            token={token}
            isPending={isPending}
            onRevoke={() => openRevokeDialog(token)}
          />
        ))}
        {tokens.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-[var(--muted-strong)]">
            No tokens yet. Create one when your local agent or terminal skill needs direct access.
          </div>
        ) : null}
        {tokens.length > 0 && visibleTokens.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-[var(--muted-strong)]">
            No active tokens.
          </div>
        ) : null}
      </div>

      {hiddenTokens.length > 0 ? (
        <details className="mt-3 rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)]">
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-bold text-[var(--ink)]">
            Token history ({hiddenTokens.length})
          </summary>
          <div className="border-t border-[var(--line)]">
            {hiddenTokens.map((token) => (
              <TokenRow
                key={token.id}
                token={token}
                isPending={isPending}
                onRevoke={() => openRevokeDialog(token)}
              />
            ))}
          </div>
        </details>
      ) : null}

      <span aria-live="polite" className="mt-2 block">
        {status ? <span className="text-[12px] text-[var(--danger)]">{status}</span> : null}
      </span>
      <span className="sr-only" aria-live="polite">
        {activeCount} active tokens
      </span>

      {/* Create token dialog */}
      <dialog
        ref={createDialogRef}
        aria-label="New agent token"
        className="fb-dialog"
        onClose={() => {
          setCreateOpen(false);
          setTokenName("");
        }}
      >
        {createOpen ? (
          <div className="fb-dialog-inner">
            <h3 className="fb-section-heading">New agent token</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted-strong)]">
              Give this token a name so you can recognize it later
              (e.g. <em>My Mac · Claude Code</em>).
            </p>
            <input
              autoComplete="off"
              className="fb-input mt-3 w-full"
              disabled={isPending}
              maxLength={80}
              onChange={(e) => setTokenName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitCreate();
                }
              }}
              placeholder="Token name"
              ref={createInputRef}
              type="text"
              value={tokenName}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="fb-btn light compact"
                onClick={closeCreateDialog}
                type="button"
              >
                Cancel
              </button>
              <button
                className="fb-btn dark compact"
                disabled={isPending || !tokenName.trim()}
                onClick={submitCreate}
                type="button"
              >
                {isPending ? "Creating..." : "Create token"}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>

      {/* Revoke confirm dialog */}
      <dialog
        ref={revokeDialogRef}
        className="fb-dialog"
        onClose={closeRevokeDialog}
      >
        {revokeTarget ? (
          <div className="fb-dialog-inner">
            <h3 className="fb-section-heading">Revoke token &ldquo;{revokeTarget.name}&rdquo;?</h3>
            <div className="mt-3 text-[13px] leading-relaxed text-[var(--muted-strong)]">
              {revokeTarget.lastIp || revokeTarget.lastUserAgent || revokeTarget.lastUsedAt ? (
                <>
                  <p>
                    This token has been used by{" "}
                    <strong>{describeMachine(revokeTarget)}</strong>
                    {revokeTarget.lastIp ? (
                      <>
                        {" "}from <span className="mono">{revokeTarget.lastIp}</span>
                      </>
                    ) : null}
                    {revokeTarget.lastUsedAt ? (
                      <> ({formatDate(revokeTarget.lastUsedAt)})</>
                    ) : null}
                    .
                  </p>
                  <p className="mt-2 text-[var(--danger)]">
                    After revoke, any agent or terminal session on that machine will
                    immediately lose access to FollowBrief and need a new token to
                    sync again.
                  </p>
                </>
              ) : (
                <p>
                  This token has never been used. Revoking it now is safe — no
                  machine will lose access.
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="fb-btn light compact"
                onClick={closeRevokeDialog}
                type="button"
              >
                Cancel
              </button>
              <button
                className="fb-btn danger compact"
                onClick={confirmRevoke}
                type="button"
              >
                Revoke
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function TokenRow({
  token,
  isPending,
  onRevoke,
}: {
  token: AgentTokenListItem;
  isPending: boolean;
  onRevoke: () => void;
}) {
  return (
    <div className={`fb-token-row${token.revokedAt ? " fb-row--revoked" : ""}`}>
      <span className="fb-src-icon fb-src-icon--md">
        <KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-bold">{token.name}</div>
        <div className="fb-src-meta">
          <span>Created {formatDate(token.createdAt)}</span>
          {token.lastUsedAt ? (
            <>
              <span>·</span>
              <span>Last used {formatDate(token.lastUsedAt)}</span>
            </>
          ) : null}
          {token.lastUsedAt ? (
            <>
              <span>·</span>
              <span>{describeMachine(token)}</span>
            </>
          ) : null}
          {token.lastIp ? (
            <>
              <span>·</span>
              <span className="mono">{token.lastIp}</span>
            </>
          ) : null}
          {token.revokedAt ? (
            <>
              <span>·</span>
              <span>Revoked {formatDate(token.revokedAt)}</span>
            </>
          ) : null}
        </div>
      </div>
      {token.revokedAt ? (
        <span className="fb-kind-pill">inactive</span>
      ) : (
        <button
          className="fb-btn ghost compact"
          disabled={isPending}
          onClick={onRevoke}
          type="button"
        >
          Revoke
        </button>
      )}
    </div>
  );
}
