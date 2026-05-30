"use client";

import { useState, useTransition } from "react";
import {
  FieldShell,
  formatUtcDateTime,
  OrderedChoiceField,
  SaveStatus,
  Section,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";

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

type Status = SaveStatusState;

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
    digestOrder: initialConfig.digestOrder,
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    const digestOrder = draft.digestOrder;
    if (digestOrder.length === 0) {
      setStatus({
        kind: "error",
        message: "Add at least one source to the digest order.",
      });
      return;
    }
    const unknown = digestOrder.filter((id) => !knownSourceIds.includes(id));
    if (unknown.length > 0) {
      setStatus({
        kind: "error",
        message: `These sources aren't recognized: ${unknown.join(", ")}.`,
      });
      return;
    }
    if (draft.commonSummaryRules.trim().length === 0) {
      setStatus({
        kind: "error",
        message: "Common summary rules can't be empty.",
      });
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
        setStatus({ kind: "saved", message: "Saved" });
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
        <OrderedChoiceField
          label="Source order"
          description="Sections appear in the digest in this order. Add known sources and reorder with the arrows."
          value={draft.digestOrder}
          options={knownSourceIds.map((id) => ({ value: id, label: id }))}
          onChange={(next) => update("digestOrder", next)}
          addLabel="Add a source…"
        />
        <FieldShell
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
        </FieldShell>
      </Section>

      <Section
        title="Digest prompts"
        description="Prompts that wrap the assembled per-source summaries into the final daily digest."
      >
        <FieldShell
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
        </FieldShell>
        <FieldShell
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
        </FieldShell>
        <FieldShell
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
        </FieldShell>
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
        <SaveStatus
          status={status.kind === "saving" ? { kind: "idle" } : status}
        />
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
