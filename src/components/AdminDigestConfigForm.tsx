"use client";

import { useState, useTransition } from "react";
import {
  FieldBlock,
  FooterBar,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";
import { MarkdownEditor } from "@/components/settings/MarkdownEditor";

export type AdminDigestConfig = {
  id: string;
  headlinePrompt: string;
  perSourceSummaryPrompt: string;
  updatedAt: string;
  updatedBy: string | null;
};

type Status = SaveStatusState;

const HEADLINE_PROMPT_PLACEHOLDER = [
  "Example:",
  "Write headlineSummary in context.language as compact source lines.",
  "Prefer '- Source name: one sentence summary'.",
  "Combine sources as '- Source A and Source B: one sentence summary' only when needed to stay under 1200 characters.",
  "Keep each source summary to 50 CJK characters or 50 words.",
  "Use only facts from the candidate post summaries. Do not include raw URLs.",
].join("\n");

const PER_SOURCE_SUMMARY_PROMPT_PLACEHOLDER = [
  "Example:",
  "You receive one source and its candidate posts.",
  "Write a short source-level summary only when multiple posts are meaningfully about the same actor or main subject.",
  "If there is only one post or the posts are unrelated, output an empty string.",
].join("\n");

export function AdminDigestConfigForm({
  initialConfig,
  canEditDigestAssemblyPrompts = true,
}: {
  initialConfig: AdminDigestConfig;
  canEditDigestAssemblyPrompts?: boolean;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [draft, setDraft] = useState({
    headlinePrompt: initialConfig.headlinePrompt,
    perSourceSummaryPrompt: initialConfig.perSourceSummaryPrompt,
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const dirty =
    canEditDigestAssemblyPrompts &&
    (draft.headlinePrompt !== config.headlinePrompt ||
      draft.perSourceSummaryPrompt !== config.perSourceSummaryPrompt);

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (status.kind !== "idle") setStatus({ kind: "idle" });
  }

  function reset() {
    setDraft({
      headlinePrompt: config.headlinePrompt,
      perSourceSummaryPrompt: config.perSourceSummaryPrompt,
    });
    setStatus({ kind: "idle" });
  }

  function clearSavedStatus() {
    setStatus((current) => (current.kind === "saved" ? { kind: "idle" } : current));
  }

  function save() {
    if (canEditDigestAssemblyPrompts && draft.headlinePrompt.trim().length === 0) {
      setStatus({ kind: "error", message: "Headline prompt cannot be empty." });
      return;
    }
    const patch: {
      headlinePrompt?: string;
      perSourceSummaryPrompt?: string;
    } = {};
    if (canEditDigestAssemblyPrompts) {
      patch.headlinePrompt = draft.headlinePrompt;
      patch.perSourceSummaryPrompt =
        draft.perSourceSummaryPrompt.trim().length === 0 ? "" : draft.perSourceSummaryPrompt;
    }
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
          setStatus({
            kind: "error",
            message: body?.error ?? "Could not save AI Digest rules.",
          });
          return;
        }
        setConfig(body.config);
        setDraft({
          headlinePrompt: body.config.headlinePrompt,
          perSourceSummaryPrompt: body.config.perSourceSummaryPrompt,
        });
        setStatus({ kind: "saved", message: "Saved" });
      } catch {
        setStatus({
          kind: "error",
          message: "Could not save AI Digest rules.",
        });
      }
    });
  }

  return (
    <div className="settings-config-form digest-composition-form">
      {canEditDigestAssemblyPrompts ? (
        <>
          <FieldBlock
            label="Headline prompt"
            description="Writes the headline summary in the selected language."
          >
            <MarkdownEditor
              ariaLabel="Headline prompt"
              height={220}
              placeholder={HEADLINE_PROMPT_PLACEHOLDER}
              value={draft.headlinePrompt}
              onChange={(value) => update("headlinePrompt", value)}
            />
          </FieldBlock>
          <FieldBlock
            label="Per-source summary prompt"
            description="Adds an optional note above a source's posts."
            optional
          >
            <MarkdownEditor
              ariaLabel="Per-source summary prompt"
              height={260}
              placeholder={PER_SOURCE_SUMMARY_PROMPT_PLACEHOLDER}
              value={draft.perSourceSummaryPrompt}
              onChange={(value) => update("perSourceSummaryPrompt", value)}
            />
          </FieldBlock>
        </>
      ) : null}

      <FooterBar
        dirty={dirty}
        isPending={isPending}
        status={status}
        onSave={save}
        onReset={reset}
        onStatusAutoDismiss={clearSavedStatus}
        updatedAt={config.updatedAt}
      />
    </div>
  );
}
