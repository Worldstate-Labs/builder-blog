"use client";

import { useState, useTransition } from "react";
import {
  FooterBar,
  Section,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";
import { MarkdownEditor } from "@/components/settings/MarkdownEditor";

type CommonSummaryRulesFormProps = {
  initialValue: string;
  updatedAt: string;
};

export function CommonSummaryRulesForm({
  initialValue,
  updatedAt,
}: CommonSummaryRulesFormProps) {
  const [value, setValue] = useState(initialValue);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [savedUpdatedAt, setSavedUpdatedAt] = useState(updatedAt);
  const [status, setStatus] = useState<SaveStatusState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const dirty = value !== savedValue;

  function save() {
    if (value.trim().length === 0) {
      setStatus({ kind: "error", message: "Common summary rules can't be empty." });
      return;
    }
    setStatus({ kind: "saving" });
    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/digest-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patch: { commonSummaryRules: value } }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        const nextValue = body.config?.commonSummaryRules ?? value;
        setSavedValue(nextValue);
        setValue(nextValue);
        setSavedUpdatedAt(body.config?.updatedAt ?? savedUpdatedAt);
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
    <Section
      title="Common post-summary rules"
      description="Applied when each fetched post is summarized before it can appear in feeds or AI Digest."
    >
      <div className="common-summary-rules-form">
        <MarkdownEditor
          ariaLabel="Common post-summary rules"
          height={340}
          value={value}
          onChange={(next) => {
            setValue(next);
            if (status.kind !== "idle") setStatus({ kind: "idle" });
          }}
        />
        <FooterBar
          dirty={dirty}
          isPending={isPending}
          status={status}
          onSave={save}
          onReset={() => {
            setValue(savedValue);
            setStatus({ kind: "idle" });
          }}
          updatedAt={savedUpdatedAt}
        />
      </div>
    </Section>
  );
}
