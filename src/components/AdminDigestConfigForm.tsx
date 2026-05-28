"use client";

import { useState, useTransition } from "react";

export type AdminDigestConfig = {
  id: string;
  digestTopPrompt: string;
  digestIntro: string;
  translate: string;
  digestOrder: string[];
  commonSummaryRules: string;
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
    commonSummaryRules: initialConfig.commonSummaryRules,
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
    if (draft.commonSummaryRules.trim().length === 0) {
      setStatus({ kind: "error", message: "commonSummaryRules cannot be empty" });
      return;
    }
    const patch = {
      commonSummaryRules: draft.commonSummaryRules,
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
    <div className="fb-panel" style={{ padding: "1.25rem 1.125rem 1rem" }}>
      <Section
        title="Composition"
        description="Which source types appear in the digest, in what order, and what rules every per-source summary must follow."
      >
        <Field label="Source order">
          <input
            className="fb-input w-full"
            style={{ fontFamily: "var(--font-geist-mono)" }}
            value={draft.digestOrder}
            onChange={(e) => update("digestOrder", e.target.value)}
            placeholder="e.g. x_twitter, podcast, blog"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              Known IDs:
            </span>
            {knownSourceIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs"
                style={{
                  background: "var(--paper-strong)",
                  color: "var(--muted-strong)",
                  fontFamily: "var(--font-geist-mono)",
                }}
              >
                {id}
              </span>
            ))}
          </div>
        </Field>
        <Field
          label="Common summarization rules"
          description="Appended to every per-source summary prompt — use for style guardrails that apply across all sources."
        >
          <textarea
            className="fb-textarea w-full"
            rows={10}
            style={{ resize: "vertical", fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem" }}
            value={draft.commonSummaryRules}
            onChange={(e) => update("commonSummaryRules", e.target.value)}
          />
        </Field>
      </Section>

      <Section
        title="Digest prompts"
        description="Prompts that wrap the assembled per-source summaries into the final daily digest."
      >
        <Field
          label="Top prompt"
          description="Sent at the very start of the digest — sets the model's role and overall task."
        >
          <textarea
            className="fb-textarea w-full"
            rows={5}
            style={{ resize: "vertical", fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem" }}
            value={draft.digestTopPrompt}
            onChange={(e) => update("digestTopPrompt", e.target.value)}
          />
        </Field>
        <Field
          label="Intro prompt"
          description="Generates the digest's opening paragraph from the assembled summaries."
        >
          <textarea
            className="fb-textarea w-full"
            rows={14}
            style={{ resize: "vertical", fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem" }}
            value={draft.digestIntro}
            onChange={(e) => update("digestIntro", e.target.value)}
          />
        </Field>
        <Field
          label="Translate prompt"
          description="Used when translating finished summaries into a user's preferred language."
        >
          <textarea
            className="fb-textarea w-full"
            rows={10}
            style={{ resize: "vertical", fontFamily: "var(--font-geist-mono)", fontSize: "0.8125rem" }}
            value={draft.translate}
            onChange={(e) => update("translate", e.target.value)}
          />
        </Field>
      </Section>

      <div
        className="mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--line)]"
        style={{ paddingTop: "0.875rem" }}
      >
        <button
          type="button"
          className="fb-btn"
          disabled={isPending || status.kind === "saving"}
          onClick={save}
        >
          {isPending || status.kind === "saving" ? "Saving…" : "Save digest config"}
        </button>
        {status.message ? (
          <span
            className={
              status.kind === "error"
                ? "text-sm text-[var(--danger)]"
                : "text-sm text-[var(--muted-strong)]"
            }
            role={status.kind === "error" ? "alert" : undefined}
          >
            {status.message}
          </span>
        ) : null}
        <span
          className="ml-auto text-xs"
          style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono)" }}
        >
          Updated {formatUtcDateTime(config.updatedAt)}
          {config.updatedBy ? ` · ${config.updatedBy}` : ""}
        </span>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-3 border-b border-[var(--line)] pb-2">
        <p
          className="text-[11px] uppercase tracking-[0.16em]"
          style={{ color: "var(--ink)", fontFamily: "var(--font-geist-mono)" }}
        >
          {title}
        </p>
        {description ? (
          <p className="mt-0.5 text-sm" style={{ color: "var(--muted-strong)" }}>
            {description}
          </p>
        ) : null}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function formatUtcDateTime(value: string) {
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

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block uppercase tracking-[0.12em] text-[var(--muted)] text-xs">
        {label}
      </span>
      {children}
      {description ? (
        <span className="mt-1 block text-xs" style={{ color: "var(--muted)" }}>
          {description}
        </span>
      ) : null}
    </label>
  );
}
