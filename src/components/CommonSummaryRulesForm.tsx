"use client";

import { useState, useTransition } from "react";
import {
  FieldShell,
  FooterBar,
  Section,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";

type CommonSummaryRulesFormProps = {
  initialValue: string;
  updatedAt: string;
  updatedBy: string | null;
};

export function CommonSummaryRulesForm({
  initialValue,
  updatedAt,
  updatedBy,
}: CommonSummaryRulesFormProps) {
  const [value, setValue] = useState(initialValue);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [savedMeta, setSavedMeta] = useState({ updatedAt, updatedBy });
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
        setSavedMeta({
          updatedAt: body.config?.updatedAt ?? savedMeta.updatedAt,
          updatedBy: body.config?.updatedBy ?? savedMeta.updatedBy,
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
    <Section
      title="Post summary rules"
      description="Applied when each fetched post is summarized before it can appear in feeds or AI Digest."
    >
      <div className="common-summary-rules-form">
        <FieldShell
          label="Common post-summary rules"
          description="Global guardrails appended to every source-specific summary prompt when a single fetched post is summarized."
        >
          <textarea
            className="fb-textarea w-full"
            rows={10}
            style={{
              resize: "vertical",
              fontFamily: "var(--font-geist-mono)",
              fontSize: "0.8125rem",
            }}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (status.kind !== "idle") setStatus({ kind: "idle" });
            }}
          />
        </FieldShell>
        <FooterBar
          dirty={dirty}
          isPending={isPending}
          status={status}
          onSave={save}
          onReset={() => {
            setValue(savedValue);
            setStatus({ kind: "idle" });
          }}
          updatedAt={savedMeta.updatedAt}
          updatedBy={savedMeta.updatedBy}
        />
      </div>
    </Section>
  );
}
