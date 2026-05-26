"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { KeyRound, Plus } from "lucide-react";

export type AgentTokenListItem = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastIp: string | null;
  lastUserAgent: string | null;
  revokedAt: string | null;
};

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
  const [tokens, setTokens] = useState(initialTokens);
  const [tokenName, setTokenName] = useState("");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Revoke confirm dialog state
  const [revokeTarget, setRevokeTarget] = useState<AgentTokenListItem | null>(null);
  const revokeDialogRef = useRef<HTMLDialogElement>(null);

  const activeCount = useMemo(
    () => tokens.filter((token) => !token.revokedAt).length,
    [tokens],
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
      } catch (error) {
        setTokens(previousTokens);
        setStatus(error instanceof Error ? error.message : "Token revoke failed");
      }
    });
  }

  // Build the bootstrap command from the live origin so the copied snippet always
  // points at the deployment the user is signed into.
  const bootstrapCommand =
    typeof window !== "undefined"
      ? `/bin/sh -c "$(curl -fsSL ${window.location.origin}/api/skill/bootstrap)"`
      : '/bin/sh -c "$(curl -fsSL /api/skill/bootstrap)"';

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
          onClick={openCreateDialog}
          type="button"
        >
          <Plus aria-hidden="true" />
          New token
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

      <div className="mt-4 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--paper-strong)]">
        {tokens.map((token) => (
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
      </div>

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
              {revokeTarget.lastIp || revokeTarget.lastUserAgent ? (
                <p>
                  Last used from{" "}
                  {revokeTarget.lastIp ? <strong>{revokeTarget.lastIp}</strong> : null}
                  {revokeTarget.lastIp && revokeTarget.lastUserAgent ? " · " : null}
                  {revokeTarget.lastUserAgent ? (
                    <strong>{summarizeUserAgent(revokeTarget.lastUserAgent)}</strong>
                  ) : null}
                  {revokeTarget.lastUsedAt ? (
                    <> · {formatDate(revokeTarget.lastUsedAt)}</>
                  ) : null}
                  .
                </p>
              ) : null}
              <p className="mt-2">
                Any agent job running on this machine will stop being able to reach FollowBrief.
              </p>
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
  return new Date(value).toLocaleString();
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
    <div className="fb-token-row" style={{ opacity: token.revokedAt ? 0.55 : 1 }}>
      <span className="fb-src-icon" style={{ width: "2rem", height: "2rem" }}>
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
          {token.lastIp ? (
            <>
              <span>·</span>
              <span>{token.lastIp}</span>
            </>
          ) : null}
          {token.lastUserAgent ? (
            <>
              <span>·</span>
              <span>{summarizeUserAgent(token.lastUserAgent)}</span>
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
          onClick={onRevoke}
          type="button"
        >
          Revoke
        </button>
      )}
    </div>
  );
}
