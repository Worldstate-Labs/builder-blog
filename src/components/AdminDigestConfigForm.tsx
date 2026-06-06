"use client";

import { useState, useTransition } from "react";
import {
  FieldBlock,
  FooterBar,
  Section,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";
import { MarkdownEditor } from "@/components/settings/MarkdownEditor";

export type AdminDigestConfig = {
  id: string;
  headlinePrompt: string;
  perSourceSummaryPrompt: string;
  translate: string;
  updatedAt: string;
  updatedBy: string | null;
};

type Status = SaveStatusState;

const HEADLINE_PROMPT_PLACEHOLDER = [
  "Example:",
  "Write a compact headlineSummary in context.language.",
  "Keep it to 300 characters or fewer.",
  "Use only facts from the candidate post summaries. Do not include raw URLs.",
].join("\n");

const PER_SOURCE_SUMMARY_PROMPT_PLACEHOLDER = [
  "Example:",
  "You receive one source and its candidate posts.",
  "Write a short source-level summary only when multiple posts are meaningfully about the same actor or main subject.",
  "If there is only one post or the posts are unrelated, output an empty string.",
].join("\n");

const TRANSLATE_PROMPT_PLACEHOLDER = [
  "Example:",
  "Rewrite or translate the supplied per-post summary into context.language.",
  "Keep Chinese output under 300 Chinese characters. For word-delimited languages, keep it under 300 words. Preserve the original summary's key claims, names, numbers, URLs, and source attribution.",
  "",
  "Do not write headlineSummary or source-level summaries. Keep product names, people, companies, URLs, and common AI terms in English when professionals normally use them that way.",
].join("\n");

export function AdminDigestConfigForm({
  initialConfig,
}: {
  initialConfig: AdminDigestConfig;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [draft, setDraft] = useState({
    headlinePrompt: initialConfig.headlinePrompt,
    perSourceSummaryPrompt: initialConfig.perSourceSummaryPrompt,
    translate: initialConfig.translate,
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const dirty =
    draft.headlinePrompt !== config.headlinePrompt ||
    draft.perSourceSummaryPrompt !== config.perSourceSummaryPrompt ||
    draft.translate !== config.translate;

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (status.kind !== "idle") setStatus({ kind: "idle" });
  }

  function reset() {
    setDraft({
      headlinePrompt: config.headlinePrompt,
      perSourceSummaryPrompt: config.perSourceSummaryPrompt,
      translate: config.translate,
    });
    setStatus({ kind: "idle" });
  }

  function save() {
    const patch = {
      headlinePrompt: draft.headlinePrompt,
      perSourceSummaryPrompt: draft.perSourceSummaryPrompt,
      translate: draft.translate,
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
        setDraft({
          headlinePrompt: body.config.headlinePrompt,
          perSourceSummaryPrompt: body.config.perSourceSummaryPrompt,
          translate: body.config.translate,
        });
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
        title="Digest prompts"
        description="Prompts used after posts already have per-post summaries."
      >
        <FieldBlock
          label="Headline prompt"
          description="Writes the short headline summary in the selected digest language."
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
          description="Optionally writes one source-level note above that source's posts."
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
        <FieldBlock
          label="Translate prompt"
          description="Rewrites or translates existing per-post summaries, then compresses them without dropping key points."
        >
          <MarkdownEditor
            ariaLabel="Translate prompt"
            height={340}
            placeholder={TRANSLATE_PROMPT_PLACEHOLDER}
            value={draft.translate}
            onChange={(value) => update("translate", value)}
          />
        </FieldBlock>
      </Section>

      <FooterBar
        dirty={dirty}
        isPending={isPending}
        status={status}
        onSave={save}
        onReset={reset}
        updatedAt={config.updatedAt}
      />
    </div>
  );
}
