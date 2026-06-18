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
      description="Used when fetched posts are summarized for Following or AI Digest."
      emptyMessage="Common summary rules cannot be empty."
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
      description="Used before source-specific Local Agent fetch prompts."
      emptyMessage="Common fetching rules cannot be empty."
      fieldName="commonFetchRules"
      initialValue={initialValue}
      placeholder={[
        "Example:",
        "Choose an extraction method from task.item.url, task.sourceType, and task.agentWorkType.",
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

  function clearSavedStatus() {
    setStatus((current) => (current.kind === "saved" ? { kind: "idle" } : current));
  }

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
          message: error instanceof Error ? error.message : `Could not save ${title.toLowerCase()}.`,
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
          onStatusAutoDismiss={clearSavedStatus}
          updatedAt={savedUpdatedAt}
        />
      </div>
    </Section>
  );
}
