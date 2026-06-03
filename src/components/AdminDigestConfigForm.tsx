"use client";

import { useState, useTransition } from "react";
import {
  FieldShell,
  FooterBar,
  OrderedChoiceField,
  Section,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";

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

      <FooterBar
        dirty={dirty}
        isPending={isPending}
        status={status}
        onSave={save}
        onReset={reset}
        updatedAt={config.updatedAt}
        updatedBy={config.updatedBy}
      />
    </div>
  );
}
