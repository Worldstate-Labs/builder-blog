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
  return (
    <CommonRulesForm
      ariaLabel="Common post-summary rules"
      description="Applied when each fetched post is summarized before it can appear in feeds or AI Digest."
      emptyMessage="Common summary rules can't be empty."
      fieldName="commonSummaryRules"
      initialValue={initialValue}
      placeholder={[
        "Example:",
        "- Summarize exactly one supplied task item.",
        "- Use task.item.body as the primary content.",
        "- Include the direct source URL for every claim.",
      ].join("\n")}
      title="Common post-summary rules"
      updatedAt={updatedAt}
    />
  );
}

export function CommonFetchRulesForm({
  initialValue,
  updatedAt,
}: CommonSummaryRulesFormProps) {
  return (
    <CommonRulesForm
      ariaLabel="Common fetching rules"
      description="Applied before any source-specific fetch prompt when the agent needs to extract source content."
      emptyMessage="Common fetching rules can't be empty."
      fieldName="commonFetchRules"
      initialValue={initialValue}
      placeholder={[
        "Example:",
        "Use task.item.url, task.sourceType, and task.agentWorkType to choose the best available extraction method.",
        "",
        "Keep trying available methods until real primary content is obtained, or no method remains.",
      ].join("\n")}
      title="Common fetching rules"
      updatedAt={updatedAt}
    />
  );
}

function CommonRulesForm({
  ariaLabel,
  description,
  emptyMessage,
  fieldName,
  initialValue,
  placeholder,
  title,
  updatedAt,
}: CommonSummaryRulesFormProps & {
  ariaLabel: string;
  description: string;
  emptyMessage: string;
  fieldName: "commonFetchRules" | "commonSummaryRules";
  placeholder: string;
  title: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [savedUpdatedAt, setSavedUpdatedAt] = useState(updatedAt);
  const [status, setStatus] = useState<SaveStatusState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const dirty = value !== savedValue;

  function save() {
    if (value.trim().length === 0) {
      setStatus({ kind: "error", message: emptyMessage });
      return;
    }
    setStatus({ kind: "saving" });
    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/digest-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patch: { [fieldName]: value } }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        const nextValue = body.config?.[fieldName] ?? value;
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
    <Section title={title} description={description}>
      <div className="common-summary-rules-form">
        <MarkdownEditor
          ariaLabel={ariaLabel}
          height={340}
          placeholder={placeholder}
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
