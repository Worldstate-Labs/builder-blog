"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

type ActiveToken = { id: string; name: string | null };
const CLOUD_WORKER_HOST_JOB = "cloud-library-cron-setup";
const CLOUD_WORKER_STOP_JOB = "cloud-library-cron-stop";
type Runtime = "claude" | "codex" | "hermes" | "openclaw";
type PromptAction = "host" | "stop";

const RUNTIME_OPTIONS: { id: Runtime; label: string }[] = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
  { id: "hermes", label: "Hermes" },
  { id: "openclaw", label: "OpenClaw" },
];

const FETCH_LIMIT_DEFAULT = 3;
const FETCH_LIMIT_MAX = 20;
const FETCH_DAYS_DEFAULT = 30;
const FETCH_DAYS_MAX = 90;
const PARALLEL_WORKERS_DEFAULT = 1;
const PARALLEL_WORKERS_MAX = 8;

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

function normalizeNumberParam(value: string, fallback: number, min: number, max: number): string | null {
  const trimmed = value.trim();
  const numeric = trimmed === "" ? fallback : Number(trimmed);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return null;
  if (numeric < min || numeric > max) return null;
  return String(numeric);
}

function NumberField({
  id,
  label,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  max: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="cron-field">
      <label htmlFor={id} className="cron-field-label">
        {label}
      </label>
      <input
        id={id}
        className="cron-field-select"
        type="number"
        min={1}
        max={max}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function AdminCloudFetchRunActions({ activeTokens }: { activeTokens: ActiveToken[] }) {
  const [tokenId, setTokenId] = useState(activeTokens[0]?.id ?? "");
  const [runtime, setRuntime] = useState<Runtime>("codex");
  const [fetchLimit, setFetchLimit] = useState(String(FETCH_LIMIT_DEFAULT));
  const [fetchDays, setFetchDays] = useState(String(FETCH_DAYS_DEFAULT));
  const [parallelWorkers, setParallelWorkers] = useState(String(PARALLEL_WORKERS_DEFAULT));
  const [busyAction, setBusyAction] = useState<PromptAction | null>(null);
  const [status, setStatus] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [manual, setManual] = useState<string | null>(null);

  async function copyPrompt(action: PromptAction) {
    if (!tokenId) {
      setStatus({ kind: "error", text: "Create an agent access key first (Access keys in Settings)." });
      return;
    }
    const params = new URLSearchParams({ runtime });
    const job = action === "host" ? CLOUD_WORKER_HOST_JOB : CLOUD_WORKER_STOP_JOB;
    if (action === "host") {
      const postLimitParam = normalizeNumberParam(fetchLimit, FETCH_LIMIT_DEFAULT, 1, FETCH_LIMIT_MAX);
      const daysParam = normalizeNumberParam(fetchDays, FETCH_DAYS_DEFAULT, 1, FETCH_DAYS_MAX);
      const parallelParam = normalizeNumberParam(
        parallelWorkers,
        PARALLEL_WORKERS_DEFAULT,
        1,
        PARALLEL_WORKERS_MAX,
      );
      if (!postLimitParam || !daysParam || !parallelParam) {
        setStatus({
          kind: "error",
          text: "Use whole numbers in range: posts 1-20, days 1-90, workers 1-8.",
        });
        return;
      }
      params.set("postLimit", postLimitParam);
      params.set("days", daysParam);
      params.set("parallel", parallelParam);
    }
    setBusyAction(action);
    setStatus(null);
    setManual(null);
    try {
      const res = await fetch(`/api/settings/tokens/${tokenId}/exchange-code`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.code) {
        setStatus({ kind: "error", text: "Could not prepare a secure setup code. Try again." });
        return;
      }
      params.set("ec", body.code);
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
      setBusyAction(null);
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

          <NumberField
            id="cloud-run-post-limit"
            label="Posts per source"
            max={FETCH_LIMIT_MAX}
            value={fetchLimit}
            onChange={setFetchLimit}
          />

          <NumberField
            id="cloud-run-fetch-days"
            label="Lookback days"
            max={FETCH_DAYS_MAX}
            value={fetchDays}
            onChange={setFetchDays}
          />

          <div className="cron-field">
            <label htmlFor="cloud-run-parallel-workers" className="cron-field-label">
              Local workers
            </label>
            <select
              id="cloud-run-parallel-workers"
              className="cron-field-select"
              value={parallelWorkers}
              onChange={(e) => setParallelWorkers(e.target.value)}
            >
              {Array.from({ length: PARALLEL_WORKERS_MAX }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {count === 1 ? "1 worker" : `${count} workers`}
                </option>
              ))}
            </select>
          </div>
          <p className="cron-field-hint">
            Local workers control this admin machine while the worker host is running. Same-domain tasks stay on one worker.
          </p>

          <div className="settings-footer-bar">
            <button
              type="button"
              className="fb-btn dark compact"
              disabled={busyAction !== null}
              onClick={() => copyPrompt("host")}
            >
              <Copy aria-hidden="true" />
              {busyAction === "host" ? "Preparing" : "Copy worker host prompt"}
            </button>
            <button
              type="button"
              className="fb-btn light compact"
              disabled={busyAction !== null}
              onClick={() => copyPrompt("stop")}
            >
              <Copy aria-hidden="true" />
              {busyAction === "stop" ? "Preparing" : "Copy stop cloud fetch prompt"}
            </button>
          </div>

          <p className="cron-field-hint">
            First-time setup: confirm the cloud library is ready for your summary language
            (<code>check-cloud-source-fetch-readiness</code>) before the worker host starts.
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
