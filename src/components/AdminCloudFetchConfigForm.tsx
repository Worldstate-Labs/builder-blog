"use client";

import { useMemo, useState, useTransition } from "react";
import {
  FieldNumber,
  FieldText,
  FooterBar,
  Section,
  Toggle,
  type SaveStatusState,
} from "@/components/settings/SettingsFields";

export type AdminCloudFetchConfig = {
  maxTasksPerHour: number;
  maxActiveLeases: number;
  workerSecondsPerHour: number;
  defaultBatchSize: number;
  leaseTtlMinutes: number;
  schedulingLeadMinutes: number;
  planningHorizonHours: number;
  retryBaseMinutes: number;
  starvationReserveRatio: number;
  retryReserveRatio: number;
  failureCircuitBreakerThreshold: number;
  canonicalCooldownMinutes: number;
  durationColdStartBufferRatio: number;
  updatedAt: string;
};

export type AdminCloudLanguageLibrary = {
  id: string;
  summaryLanguage: string;
  ownerUserId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  enabled: boolean;
};

type Status = SaveStatusState;
type ConfigDraft = Record<keyof Omit<AdminCloudFetchConfig, "updatedAt">, string>;

const CONFIG_FIELDS: Array<{
  key: keyof ConfigDraft;
  label: string;
  min: number;
  max: number;
  step?: number;
}> = [
  { key: "maxTasksPerHour", label: "Max tasks per hour", min: 1, max: 500 },
  { key: "maxActiveLeases", label: "Max active leases", min: 1, max: 500 },
  { key: "workerSecondsPerHour", label: "Worker seconds per hour", min: 60, max: 86_400 },
  { key: "defaultBatchSize", label: "Default batch size", min: 1, max: 100 },
  { key: "leaseTtlMinutes", label: "Lease TTL minutes", min: 5, max: 240 },
  { key: "schedulingLeadMinutes", label: "Scheduling lead minutes", min: 0, max: 1_440 },
  { key: "planningHorizonHours", label: "Planning horizon hours", min: 1, max: 168 },
  { key: "retryBaseMinutes", label: "Retry base minutes", min: 5, max: 720 },
  { key: "starvationReserveRatio", label: "Starvation reserve ratio", min: 0, max: 0.5, step: 0.01 },
  { key: "retryReserveRatio", label: "Retry reserve ratio", min: 0, max: 0.5, step: 0.01 },
  { key: "failureCircuitBreakerThreshold", label: "Failure breaker threshold", min: 1, max: 50 },
  { key: "canonicalCooldownMinutes", label: "Canonical cooldown minutes", min: 0, max: 1_440 },
  { key: "durationColdStartBufferRatio", label: "Cold-start duration buffer", min: 0, max: 2, step: 0.01 },
];

export function AdminCloudFetchConfigForm({
  initialConfig,
  initialLibraries,
}: {
  initialConfig: AdminCloudFetchConfig;
  initialLibraries: AdminCloudLanguageLibrary[];
}) {
  const [config, setConfig] = useState(initialConfig);
  const [draft, setDraft] = useState(() => configDraft(initialConfig));
  const [libraries, setLibraries] = useState(initialLibraries);
  const [libraryDraft, setLibraryDraft] = useState({
    summaryLanguage: "zh",
    ownerEmail: "",
    enabled: true,
  });
  const [configStatus, setConfigStatus] = useState<Status>({ kind: "idle" });
  const [libraryStatus, setLibraryStatus] = useState<Status>({ kind: "idle" });
  const [isConfigPending, startConfigTransition] = useTransition();
  const [isLibraryPending, startLibraryTransition] = useTransition();
  const baseline = useMemo(() => configDraft(config), [config]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  function updateConfig(key: keyof ConfigDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (configStatus.kind !== "idle") setConfigStatus({ kind: "idle" });
  }

  function resetConfig() {
    setDraft(baseline);
    setConfigStatus({ kind: "idle" });
  }

  function saveConfig() {
    const patch: Record<string, number> = {};
    for (const field of CONFIG_FIELDS) {
      const value = Number(draft[field.key]);
      if (!Number.isFinite(value) || value < field.min || value > field.max) {
        setConfigStatus({ kind: "error", message: `${field.label} is out of range.` });
        return;
      }
      patch[field.key] = field.step ? value : Math.floor(value);
    }

    setConfigStatus({ kind: "saving" });
    startConfigTransition(async () => {
      try {
        const response = await fetch("/api/admin/cloud-fetch/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setConfigStatus({ kind: "error", message: body?.error ?? "Could not save cloud fetch config." });
          return;
        }
        const updated = {
          ...body.config,
          updatedAt: body.config?.updatedAt ?? new Date().toISOString(),
        };
        setConfig(updated);
        setDraft(configDraft(updated));
        setConfigStatus({ kind: "saved", message: "Saved" });
      } catch {
        setConfigStatus({ kind: "error", message: "Could not save cloud fetch config." });
      }
    });
  }

  function saveLanguageLibrary() {
    if (!libraryDraft.summaryLanguage.trim() || !libraryDraft.ownerEmail.trim()) {
      setLibraryStatus({ kind: "error", message: "Language and owner email are required." });
      return;
    }
    setLibraryStatus({ kind: "saving" });
    startLibraryTransition(async () => {
      try {
        const response = await fetch("/api/admin/cloud-fetch/language-libraries", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(libraryDraft),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setLibraryStatus({ kind: "error", message: body?.error ?? "Could not save cloud library owner." });
          return;
        }
        const next = serializeLanguageLibrary(body.library);
        setLibraries((current) => [
          next,
          ...current.filter((library) => library.summaryLanguage !== next.summaryLanguage),
        ].sort((a, b) => a.summaryLanguage.localeCompare(b.summaryLanguage)));
        setLibraryStatus({ kind: "saved", message: "Saved" });
      } catch {
        setLibraryStatus({ kind: "error", message: "Could not save cloud library owner." });
      }
    });
  }

  return (
    <div className="settings-config-form cloud-fetch-config-form">
      <Section
        step="01"
        title="Scheduler"
        description="Controls cloud source queueing, leases, retries, and fairness reserves."
      >
        {CONFIG_FIELDS.map((field) => (
          <FieldNumber
            key={field.key}
            label={field.label}
            value={draft[field.key]}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(value) => updateConfig(field.key, value)}
          />
        ))}
        <FooterBar
          dirty={dirty}
          isPending={isConfigPending}
          status={configStatus}
          updatedAt={config.updatedAt}
          onSave={saveConfig}
          onReset={resetConfig}
          onStatusAutoDismiss={() => setConfigStatus({ kind: "idle" })}
        />
      </Section>

      <Section
        step="02"
        title="Language libraries"
        description="Maps each summary language to the cloud owner whose normal source library is shared to Hub."
      >
        <div className="settings-choice-list">
          {libraries.length === 0 ? (
            <span className="settings-choice-empty">No cloud language libraries configured.</span>
          ) : (
            libraries.map((library) => (
              <span className="settings-token" key={library.id}>
                <span>
                  {library.summaryLanguage} · {library.ownerEmail ?? library.ownerUserId}
                  {library.enabled ? "" : " · disabled"}
                </span>
              </span>
            ))
          )}
        </div>
        <FieldText
          label="Summary language"
          value={libraryDraft.summaryLanguage}
          placeholder="zh"
          onChange={(value) =>
            setLibraryDraft((current) => ({ ...current, summaryLanguage: value }))
          }
        />
        <FieldText
          label="Owner email"
          value={libraryDraft.ownerEmail}
          placeholder="cloud-zh@example.com"
          onChange={(value) =>
            setLibraryDraft((current) => ({ ...current, ownerEmail: value }))
          }
        />
        <Toggle
          label="Enabled"
          checked={libraryDraft.enabled}
          onChange={(value) =>
            setLibraryDraft((current) => ({ ...current, enabled: value }))
          }
        />
        <div className="settings-footer-bar">
          <button
            className="fb-btn dark compact"
            disabled={isLibraryPending}
            type="button"
            onClick={saveLanguageLibrary}
          >
            {isLibraryPending ? "Saving" : "Save language library"}
          </button>
          {libraryStatus.kind === "error" ? (
            <span className="settings-save-status is-error" role="alert">
              {libraryStatus.message}
            </span>
          ) : libraryStatus.kind === "saved" ? (
            <span className="settings-save-status is-saved" aria-live="polite">
              Saved
            </span>
          ) : null}
        </div>
      </Section>
    </div>
  );
}

function configDraft(config: AdminCloudFetchConfig): ConfigDraft {
  return Object.fromEntries(
    CONFIG_FIELDS.map((field) => [field.key, String(config[field.key])]),
  ) as ConfigDraft;
}

function serializeLanguageLibrary(raw: {
  id: string;
  summaryLanguage: string;
  ownerUserId: string;
  enabled: boolean;
  owner?: { email?: string | null; name?: string | null } | null;
}): AdminCloudLanguageLibrary {
  return {
    id: raw.id,
    summaryLanguage: raw.summaryLanguage,
    ownerUserId: raw.ownerUserId,
    ownerEmail: raw.owner?.email ?? null,
    ownerName: raw.owner?.name ?? null,
    enabled: raw.enabled,
  };
}
