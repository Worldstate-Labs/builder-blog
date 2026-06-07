"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LaptopMinimal, Plus, Smartphone } from "lucide-react";
import { CountBadge } from "@/components/Count";
import { EmptyState } from "@/components/EmptyState";
import { useHydrated } from "@/components/ThemeToggle";

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
  if (/\b(ios|iphone|ipad)\b/.test(lower)) return platformString.slice(0, 48);
  if (/\bandroid\b/.test(lower)) return platformString.slice(0, 48);
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

function isPhoneLikeToken(token: AgentTokenListItem) {
  const haystack = `${token.lastPlatform ?? ""} ${token.lastUserAgent ?? ""}`.toLowerCase();
  return /iphone|ipad|ios|android|mobile/.test(haystack);
}

export function AgentTokenPanel({
  initialTokens,
}: {
  initialTokens: AgentTokenListItem[];
}) {
  const router = useRouter();
  const [tokenName, setTokenName] = useState("");
  const [status, setStatus] = useState("");
  const [showAllTokens, setShowAllTokens] = useState(false);
  const [isPending, startTransition] = useTransition();
  const hydrated = useHydrated();

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

  const activeTokens = useMemo(
    () => tokens.filter((token) => !token.revokedAt),
    [tokens],
  );
  const visibleTokens = showAllTokens ? activeTokens : activeTokens.slice(0, 2);
  const hiddenActiveCount = Math.max(0, activeTokens.length - 2);

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
      setStatus("Name this access key first.");
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
        setStatus(error instanceof Error ? error.message : "Could not create access key");
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
        setStatus(error instanceof Error ? error.message : "Could not revoke access key");
      }
    });
  }

  return (
    <section className="access-keys-panel fb-panel">
      <div className="access-keys-head">
        <div className="access-keys-copy">
          <h2 className="fb-section-heading">Access keys</h2>
          <p className="access-keys-desc">
            Keys let your Local Agent securely send fetched sources and digests to your FollowBrief cloud account.
          </p>
        </div>
        <button
          className="fb-btn dark compact"
          disabled={isPending}
          onClick={openCreateDialog}
          type="button"
        >
          <Plus aria-hidden="true" />
          Add access key
        </button>
      </div>

      <div className="access-keys-list">
        {visibleTokens.map((token) => (
          <TokenRow
            key={token.id}
            token={token}
            hydrated={hydrated}
            isPending={isPending}
            onRevoke={() => openRevokeDialog(token)}
          />
        ))}
        {activeTokens.length === 0 ? (
          <EmptyState
            className="access-keys-empty"
            title={tokens.length === 0 ? "No access keys yet" : "No active keys"}
            body={
              tokens.length === 0
                ? "Add one when you connect a local agent."
                : "Revoked keys are hidden from this list."
            }
          />
        ) : null}
        {hiddenActiveCount > 0 ? (
          <button
            className="access-keys-more"
            onClick={() => setShowAllTokens((current) => !current)}
            type="button"
          >
            {showAllTokens ? (
              "See less"
            ) : (
              <span className="access-keys-more-label">
                See more
                <CountBadge value={hiddenActiveCount} />
              </span>
            )}
          </button>
        ) : null}
      </div>

      <span aria-live="polite" className="access-keys-status">
        {status ? <span className="access-keys-status is-error">{status}</span> : null}
      </span>

      {/* Create token dialog */}
      <dialog
        ref={createDialogRef}
        aria-label="New access key"
        className="fb-dialog"
        onClose={() => {
          setCreateOpen(false);
          setTokenName("");
        }}
      >
        {createOpen ? (
          <div className="fb-dialog-inner settings-dialog-stack">
            <h3 className="fb-section-heading">New access key</h3>
            <p className="settings-dialog-copy">
              Give this access key a name so you can recognize it later
              (e.g. <em>My Mac · Claude Code</em>).
            </p>
            <input
              autoComplete="off"
              className="settings-dialog-input fb-input"
              disabled={isPending}
              maxLength={80}
              onChange={(e) => setTokenName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitCreate();
                }
              }}
              placeholder="Access key name"
              ref={createInputRef}
              type="text"
              value={tokenName}
            />
            <div className="settings-dialog-actions">
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
                {isPending ? "Creating..." : "Create access key"}
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
          <div className="fb-dialog-inner settings-dialog-stack">
            <h3 className="fb-section-heading">Revoke access key &ldquo;{revokeTarget.name}&rdquo;?</h3>
            <div className="settings-dialog-copy">
              {revokeTarget.lastIp || revokeTarget.lastUserAgent || revokeTarget.lastUsedAt ? (
                <>
                  <p>
                    This access key has been used by{" "}
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
                  <p className="settings-dialog-warning">
                    After revoking it, that Local Agent will lose access to
                    FollowBrief and need a new access key to update again.
                  </p>
                </>
              ) : (
                <p>
                  This access key has never been used. Revoking it now is safe.
                  No machine will lose access.
                </p>
              )}
            </div>
            <div className="settings-dialog-actions">
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

function formatRelativeCompact(value: string, hydrated: boolean) {
  if (!hydrated) return formatDate(value);
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  }
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function TokenRow({
  hydrated,
  token,
  isPending,
  onRevoke,
}: {
  hydrated: boolean;
  token: AgentTokenListItem;
  isPending: boolean;
  onRevoke: () => void;
}) {
  const DeviceIcon = isPhoneLikeToken(token) ? Smartphone : LaptopMinimal;
  const machineLabel = describeMachine(token);
  const tokenName = token.name.trim();
  const tokenLabel = machineLabel === "unknown machine" && tokenName ? tokenName : machineLabel;
  const statusLabel = token.revokedAt
    ? `Revoked ${formatRelativeCompact(token.revokedAt, hydrated)}`
    : token.lastUsedAt
      ? `Last connected ${formatRelativeCompact(token.lastUsedAt, hydrated)}`
      : "Not connected yet";

  return (
    <div className={`fb-token-row${token.revokedAt ? " fb-row--revoked" : ""}`}>
      <span className="access-key-device-icon" aria-hidden="true">
        <DeviceIcon className="h-5 w-5" />
      </span>
      <div className="access-key-device-copy">
        <div className="access-key-device-title">{tokenLabel}</div>
        <div className="access-key-device-status">{statusLabel}</div>
      </div>
      {token.revokedAt ? (
        <span className="access-key-revoked-pill">Revoked</span>
      ) : (
        <button
          className="access-key-revoke-button"
          disabled={isPending}
          onClick={onRevoke}
          type="button"
        >
          Revoke access
        </button>
      )}
    </div>
  );
}
