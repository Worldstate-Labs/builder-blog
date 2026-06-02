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
      digestIntro: draft.digestIntro,
      translate: draft.translate,
      digestOrder,
    };
    setStatus({ kind: "saving" });
    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/digest-config", {
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
    <div className="settings-config-form digest-composition-form">
      <Section
        title="Sections & order"
        description="Which source types appear in the digest, and in what order."
      >
        <OrderedChoiceField
          label="Source order"
          description="Sections appear in the digest in this order. Add known sources and reorder with the arrows."
          value={draft.digestOrder}
          options={knownSourceIds.map((id) => ({ value: id, label: id }))}
          onChange={(next) => update("digestOrder", next)}
          addLabel="Add a source…"
        />
      </Section>

      <Section
        title="Per-post summary rules"
        description="Applied when each post is summarized at fetch time — appended to every per-source summary prompt. This shapes the individual summaries, not how the digest is assembled."
      >
        <FieldShell
          label="Common summarization rules"
          description="Style guardrails that apply across all sources (every per-source summary prompt gets these appended)."
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
