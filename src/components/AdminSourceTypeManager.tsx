"use client";

import { useState, useTransition } from "react";

export type AdminSourceTypeConfig = {
  sourceId: string;
  label: string;
  agentDefaultStatus: string;
  defaultCrawlDays: number;
  defaultCrawlLimit: number;
  contentQuality: unknown;
  summaryPromptBody: string;
  summaryPromptSinglePostAdaptation: string;
  summaryStyle: string;
  summaryLanguage: string;
  summaryLengthHint: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

type Status = { kind: "idle" | "saving" | "saved" | "error"; message?: string };

export function AdminSourceTypeManager({
  initialConfigs,
}: {
  initialConfigs: AdminSourceTypeConfig[];
}) {
  const [configs, setConfigs] = useState(initialConfigs);

  return (
    <div className="grid gap-3">
      {configs.map((config) => (
        <SourceTypeCard
          key={config.sourceId}
          config={config}
          onSaved={(next) =>
            setConfigs((current) =>
              current.map((c) => (c.sourceId === next.sourceId ? next : c)),
            )
          }
        />
      ))}
    </div>
  );
}

function SourceTypeCard({
  config,
  onSaved,
}: {
  config: AdminSourceTypeConfig;
  onSaved: (next: AdminSourceTypeConfig) => void;
}) {
  const [draft, setDraft] = useState({
    label: config.label,
    summaryPromptBody: config.summaryPromptBody,
    summaryPromptSinglePostAdaptation: config.summaryPromptSinglePostAdaptation,
    summaryStyle: config.summaryStyle,
    summaryLanguage: config.summaryLanguage,
    summaryLengthHint: config.summaryLengthHint ?? "",
    agentDefaultStatus: config.agentDefaultStatus,
    defaultCrawlDays: String(config.defaultCrawlDays),
    defaultCrawlLimit: String(config.defaultCrawlLimit),
    contentQualityJson: JSON.stringify(config.contentQuality, null, 2),
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    setStatus({ kind: "saving" });
    let contentQuality: unknown;
    try {
      contentQuality = JSON.parse(draft.contentQualityJson);
    } catch (error) {
      setStatus({
        kind: "error",
        message: `contentQuality is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    const defaultCrawlDays = Number(draft.defaultCrawlDays);
    const defaultCrawlLimit = Number(draft.defaultCrawlLimit);
    if (!Number.isFinite(defaultCrawlDays) || defaultCrawlDays < 1) {
      setStatus({ kind: "error", message: "defaultCrawlDays must be a positive integer" });
      return;
    }
    if (!Number.isFinite(defaultCrawlLimit) || defaultCrawlLimit < 1) {
      setStatus({ kind: "error", message: "defaultCrawlLimit must be a positive integer" });
      return;
    }

    const patch = {
      label: draft.label,
      summaryPromptBody: draft.summaryPromptBody,
      summaryPromptSinglePostAdaptation: draft.summaryPromptSinglePostAdaptation,
      summaryStyle: draft.summaryStyle,
      summaryLanguage: draft.summaryLanguage,
      summaryLengthHint: draft.summaryLengthHint.trim() === "" ? null : draft.summaryLengthHint.trim(),
      agentDefaultStatus: draft.agentDefaultStatus,
      defaultCrawlDays,
      defaultCrawlLimit,
      contentQuality,
    };

    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/source-types", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: config.sourceId, patch }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? `HTTP ${response.status}`);
        }
        onSaved(body.config);
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
    <details className="fb-panel" open={false} style={{ padding: 0 }}>
      <summary
        className="item-summary"
        style={{ cursor: "pointer", listStyle: "none" }}
      >
        <span className="min-w-0">
          <span className="item-kicker">
            <span style={{ fontFamily: "var(--font-geist-mono)" }}>{config.sourceId}</span>
            <span>{config.summaryStyle}</span>
            <span>{config.agentDefaultStatus}</span>
          </span>
          <span className="item-title">{draft.label || config.label}</span>
        </span>
        <span className="item-summary-action">Edit</span>
      </summary>
      <div className="border-t border-[var(--line)]" style={{ padding: "1rem" }}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Label">
            <input
              className="fb-input"
              value={draft.label}
              onChange={(e) => update("label", e.target.value)}
            />
          </Field>
          <Field label="Summary style">
            <select
              className="fb-input"
              value={draft.summaryStyle}
              onChange={(e) => update("summaryStyle", e.target.value)}
            >
              <option value="x_twitter">x_twitter</option>
              <option value="podcast_or_video">podcast_or_video</option>
              <option value="blog_or_document">blog_or_document</option>
            </select>
          </Field>
          <Field label="Agent default status">
            <select
              className="fb-input"
              value={draft.agentDefaultStatus}
              onChange={(e) => update("agentDefaultStatus", e.target.value)}
            >
              <option value="ready">ready</option>
              <option value="requires_agent">requires_agent</option>
            </select>
          </Field>
          <Field label="Summary language">
            <input
              className="fb-input"
              value={draft.summaryLanguage}
              onChange={(e) => update("summaryLanguage", e.target.value)}
            />
          </Field>
          <Field label="Default crawl days">
            <input
              type="number"
              min={1}
              className="fb-input"
              value={draft.defaultCrawlDays}
              onChange={(e) => update("defaultCrawlDays", e.target.value)}
            />
          </Field>
          <Field label="Default crawl limit">
            <input
              type="number"
              min={1}
              className="fb-input"
              value={draft.defaultCrawlLimit}
              onChange={(e) => update("defaultCrawlLimit", e.target.value)}
            />
          </Field>
          <Field label="Summary length hint">
            <input
              className="fb-input"
              value={draft.summaryLengthHint}
              onChange={(e) => update("summaryLengthHint", e.target.value)}
              placeholder="optional"
            />
          </Field>
        </div>

        <Field label="Summary prompt body">
          <textarea
            className="fb-input"
            rows={10}
            value={draft.summaryPromptBody}
            onChange={(e) => update("summaryPromptBody", e.target.value)}
          />
        </Field>

        <Field label="Single-post adaptation">
          <textarea
            className="fb-input"
            rows={4}
            value={draft.summaryPromptSinglePostAdaptation}
            onChange={(e) => update("summaryPromptSinglePostAdaptation", e.target.value)}
          />
        </Field>

        <Field label="Content quality (JSON)">
          <textarea
            className="fb-input"
            rows={8}
            spellCheck={false}
            style={{ fontFamily: "var(--font-geist-mono)" }}
            value={draft.contentQualityJson}
            onChange={(e) => update("contentQualityJson", e.target.value)}
          />
        </Field>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            className="fb-button"
            disabled={isPending || status.kind === "saving"}
            onClick={save}
          >
            {isPending || status.kind === "saving" ? "Saving..." : "Save changes"}
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
    </details>
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
