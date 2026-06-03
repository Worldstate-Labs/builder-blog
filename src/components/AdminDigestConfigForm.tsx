"use client";

import { useState, useTransition } from "react";
import {
  FooterBar,
  Section,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";
import { MarkdownEditor } from "@/components/settings/MarkdownEditor";

export type AdminDigestConfig = {
  id: string;
  digestIntro: string;
  translate: string;
  updatedAt: string;
  updatedBy: string | null;
};

type Status = SaveStatusState;

const DIGEST_INTRO_PLACEHOLDER = [
  "Example:",
  "Start with: AI Digest - [Date]",
  "",
  "Then organize content in this order:",
  "",
  "1. X / Twitter section - list each builder with new posts",
  "2. Official Blogs section - list each blog post from AI companies or builders",
  "3. Podcasts section - list each podcast or video episode with new content",
].join("\n");

const TRANSLATE_PROMPT_PLACEHOLDER = [
  "Example:",
  "Translate the finished digest into context.language.",
  "",
  "Keep product names, people, companies, URLs, and common AI terms in English when professionals normally use them that way.",
].join("\n");

export function AdminDigestConfigForm({
  initialConfig,
}: {
  initialConfig: AdminDigestConfig;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [draft, setDraft] = useState({
    digestIntro: initialConfig.digestIntro,
    translate: initialConfig.translate,
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const dirty = draft.digestIntro !== config.digestIntro || draft.translate !== config.translate;

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (status.kind !== "idle") setStatus({ kind: "idle" });
  }

  function reset() {
    setDraft({
      digestIntro: config.digestIntro,
      translate: config.translate,
    });
    setStatus({ kind: "idle" });
  }

  function save() {
    const patch = {
      digestIntro: draft.digestIntro,
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
          digestIntro: body.config.digestIntro,
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
        description="Prompts that assemble and translate the final digest from existing per-post summaries."
      >
        <div className="settings-field block text-sm">
          <span
            className="settings-field-label mb-1 flex items-baseline gap-1.5 text-[11px] uppercase tracking-[0.12em]"
            style={{ color: "var(--muted)" }}
          >
            Intro prompt
          </span>
          <MarkdownEditor
            ariaLabel="Intro prompt"
            height={420}
            placeholder={DIGEST_INTRO_PLACEHOLDER}
            value={draft.digestIntro}
            onChange={(value) => update("digestIntro", value)}
          />
          <span className="settings-field-help mt-1 block text-xs" style={{ color: "var(--muted)" }}>
            Generates the digest&apos;s opening paragraph from the assembled summaries.
          </span>
        </div>
        <div className="settings-field block text-sm">
          <span
            className="settings-field-label mb-1 flex items-baseline gap-1.5 text-[11px] uppercase tracking-[0.12em]"
            style={{ color: "var(--muted)" }}
          >
            Translate prompt
          </span>
          <MarkdownEditor
            ariaLabel="Translate prompt"
            height={340}
            placeholder={TRANSLATE_PROMPT_PLACEHOLDER}
            value={draft.translate}
            onChange={(value) => update("translate", value)}
          />
          <span className="settings-field-help mt-1 block text-xs" style={{ color: "var(--muted)" }}>
            Used when translating finished summaries into a user&apos;s preferred language.
          </span>
        </div>
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
