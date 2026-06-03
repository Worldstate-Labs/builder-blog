"use client";

import { useState, useTransition } from "react";
import {
  FooterBar,
  OrderedChoiceField,
  Section,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";
import { MarkdownEditor } from "@/components/settings/MarkdownEditor";

export type AdminDigestConfig = {
  id: string;
  digestIntro: string;
  translate: string;
  digestOrder: string[];
  updatedAt: string;
  updatedBy: string | null;
};

type Status = SaveStatusState;

function sameOrder(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function AdminDigestConfigForm({
  initialConfig,
  knownSourceIds,
}: {
  initialConfig: AdminDigestConfig;
  knownSourceIds: string[];
}) {
  const [config, setConfig] = useState(initialConfig);
  const [draft, setDraft] = useState({
    digestIntro: initialConfig.digestIntro,
    translate: initialConfig.translate,
    digestOrder: initialConfig.digestOrder,
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const dirty =
    draft.digestIntro !== config.digestIntro ||
    draft.translate !== config.translate ||
    !sameOrder(draft.digestOrder, config.digestOrder);

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (status.kind !== "idle") setStatus({ kind: "idle" });
  }

  function reset() {
    setDraft({
      digestIntro: config.digestIntro,
      translate: config.translate,
      digestOrder: config.digestOrder,
    });
    setStatus({ kind: "idle" });
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
    const patch = {
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
        setDraft({
          digestIntro: body.config.digestIntro,
          translate: body.config.translate,
          digestOrder: body.config.digestOrder,
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
        title="Digest sections & order"
        description="Which source-summary sections appear in AI Digest, and in what order."
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
