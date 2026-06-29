"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

type ActiveToken = { id: string; name: string | null };
type CloudJob = "cloud-library-once" | "cloud-library-cron-setup";
type Runtime = "claude" | "codex" | "hermes" | "openclaw";

const RUNTIME_OPTIONS: { id: Runtime; label: string }[] = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
  { id: "hermes", label: "Hermes" },
  { id: "openclaw", label: "OpenClaw" },
];

// "once" runs a single lease+fetch; every other value installs a recurring
// polling schedule on that cadence.
const FREQUENCY_OPTIONS: { id: string; label: string }[] = [
  { id: "once", label: "One time" },
  { id: "30m", label: "Every 30 minutes" },
  { id: "1h", label: "Every hour" },
  { id: "12h", label: "Every 12 hours" },
  { id: "daily", label: "Every day" },
  { id: "weekly", label: "Every week" },
];

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && document.hasFocus()) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to manual copy
  }
  return false;
}

export function AdminCloudFetchRunActions({ activeTokens }: { activeTokens: ActiveToken[] }) {
  const [tokenId, setTokenId] = useState(activeTokens[0]?.id ?? "");
  const [runtime, setRuntime] = useState<Runtime>("codex");
  const [frequency, setFrequency] = useState("12h");
  const [busy, setBusy] = useState<CloudJob | null>(null);
  const [status, setStatus] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [manual, setManual] = useState<string | null>(null);

  async function copyPrompt(job: CloudJob) {
    if (!tokenId) {
      setStatus({ kind: "error", text: "Create an agent access key first (Access keys in Settings)." });
      return;
    }
    setBusy(job);
    setStatus(null);
    setManual(null);
    try {
      const res = await fetch(`/api/settings/tokens/${tokenId}/exchange-code`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.code) {
        setStatus({ kind: "error", text: "Could not prepare a secure setup code. Try again." });
        return;
      }
      const params = new URLSearchParams({ ec: body.code, runtime });
      if (job === "cloud-library-cron-setup") params.set("freq", frequency);
      const url = `${window.location.origin}/api/skill/jobs/${job}/skill.md?${params.toString()}`;
      const command = `Read ${url} and follow the instructions.`;
      if (await copyText(command)) {
        setStatus({ kind: "info", text: "Copied. Valid for 10 minutes. Send it to your local agent." });
      } else {
        setManual(command);
        setStatus({ kind: "error", text: "Clipboard blocked. Select and copy the prompt below." });
      }
    } catch {
      setStatus({ kind: "error", text: "Could not prepare a Local Agent prompt." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="settings-config-form">
      {activeTokens.length === 0 ? (
        <p className="cron-field-hint">
          No agent access key found. Create one in Settings → Access keys, then return here.
        </p>
      ) : (
        <>
          {activeTokens.length > 1 ? (
            <div className="cron-field">
              <label htmlFor="cloud-run-token" className="cron-field-label">
                Access key
              </label>
              <select
                id="cloud-run-token"
                className="cron-field-select"
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value)}
              >
                {activeTokens.map((token) => (
                  <option key={token.id} value={token.id}>
                    {token.name ?? token.id}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="cron-field">
            <label htmlFor="cloud-run-runtime" className="cron-field-label">
              Runtime
            </label>
            <select
              id="cloud-run-runtime"
              className="cron-field-select"
              value={runtime}
              onChange={(e) => setRuntime(e.target.value as Runtime)}
            >
              {RUNTIME_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="cron-field">
            <label htmlFor="cloud-run-frequency" className="cron-field-label">
              Frequency
            </label>
            <select
              id="cloud-run-frequency"
              className="cron-field-select"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              {FREQUENCY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-footer-bar">
            <button
              type="button"
              className="fb-btn dark compact"
              disabled={busy !== null}
              onClick={() =>
                copyPrompt(
                  frequency === "once" ? "cloud-library-once" : "cloud-library-cron-setup",
                )
              }
            >
              <Copy aria-hidden="true" />
              {busy !== null
                ? "Preparing"
                : frequency === "once"
                  ? "Copy run-once prompt"
                  : "Copy recurring-polling prompt"}
            </button>
          </div>

          <p className="cron-field-hint">
            Run the readiness check
            (<code>npx tsx scripts/check-cloud-source-fetch-readiness.mts --language zh</code>)
            before the first real run.
          </p>

          {status ? (
            <p className={status.kind === "error" ? "cron-field-error" : "cron-field-hint"} role="status">
              {status.text}
            </p>
          ) : null}
          {manual ? (
            <textarea className="cron-field-select" readOnly rows={3} value={manual} />
          ) : null}
        </>
      )}
    </div>
  );
}
