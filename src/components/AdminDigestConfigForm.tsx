"use client";

import { useState, useTransition } from "react";

export type AdminDigestConfig = {
  id: string;
  digestTopPrompt: string;
  digestIntro: string;
  translate: string;
  digestOrder: string[];
  updatedAt: string;
  updatedBy: string | null;
};

type Status = { kind: "idle" | "saving" | "saved" | "error"; message?: string };

export function AdminDigestConfigForm({
  initialConfig,
  knownSourceIds,
}: {
  initialConfig: AdminDigestConfig;
  knownSourceIds: string[];
}) {
  const [config, setConfig] = useState(initialConfig);
  const [draft, setDraft] = useState({
    digestTopPrompt: initialConfig.digestTopPrompt,
    digestIntro: initialConfig.digestIntro,
    translate: initialConfig.translate,
    digestOrder: initialConfig.digestOrder.join(", "),
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    const digestOrder = draft.digestOrder
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (digestOrder.length === 0) {
      setStatus({ kind: "error", message: "digestOrder cannot be empty" });
      return;
    }
    const unknown = digestOrder.filter((id) => !knownSourceIds.includes(id));
    if (unknown.length > 0) {
      setStatus({
        kind: "error",
        message: `Unknown source IDs in digestOrder: ${unknown.join(", ")}. Known: ${knownSourceIds.join(", ")}`,
      });
      return;
    }
    const patch = {
      digestTopPrompt: draft.digestTopPrompt,
      digestIntro: draft.digestIntro,
      translate: draft.translate,
      digestOrder,
    };
    setStatus({ kind: "saving" });
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/digest-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patch }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        setConfig(body.config);
        setStatus({ kind: "saved", message: "Saved." });
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Save failed",
        });
      }
    });
  }

  return (
    <div className="fb-panel" style={{ padding: "1rem" }}>
      <Field label="Digest top prompt">
        <textarea
          className="fb-textarea w-full"
          rows={5}
          style={{ resize: "vertical", fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem" }}
          value={draft.digestTopPrompt}
          onChange={(e) => update("digestTopPrompt", e.target.value)}
        />
      </Field>
      <Field label="Digest intro prompt">
        <textarea
          className="fb-textarea w-full"
          rows={14}
          style={{ resize: "vertical", fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem" }}
          value={draft.digestIntro}
          onChange={(e) => update("digestIntro", e.target.value)}
        />
      </Field>
      <Field label="Translate prompt">
        <textarea
          className="fb-textarea w-full"
          rows={10}
          style={{ resize: "vertical", fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem" }}
          value={draft.translate}
          onChange={(e) => update("translate", e.target.value)}
        />
      </Field>
      <Field label={`Digest order (comma-separated; known: ${knownSourceIds.join(", ")})`}>
        <input
          className="fb-input"
          style={{ fontFamily: "var(--font-geist-mono)" }}
          value={draft.digestOrder}
          onChange={(e) => update("digestOrder", e.target.value)}
        />
      </Field>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="fb-button"
          disabled={isPending || status.kind === "saving"}
          onClick={save}
        >
          {isPending || status.kind === "saving" ? "Saving..." : "Save digest config"}
        </button>
        {status.message ? (
          <span
            className={
              status.kind === "error"
                ? "text-sm text-[var(--danger)]"
                : "text-sm text-[var(--muted-strong)]"
            }
          >
            {status.message}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-[var(--muted)]">
          Updated {new Date(config.updatedAt).toLocaleString()}
          {config.updatedBy ? ` · ${config.updatedBy}` : ""}
        </span>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-3 block text-sm">
      <span className="mb-1 block uppercase tracking-[0.12em] text-[var(--muted)] text-xs">
        {label}
      </span>
      {children}
    </label>
  );
}
