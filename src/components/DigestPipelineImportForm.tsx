"use client";

import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { CheckCircle2, Download, Radio, Trash2 } from "lucide-react";
import { CountMeta } from "@/components/Count";
import { DigestPipelineTitleEditor } from "@/components/DigestPipelineTitleEditor";
import { EmptyState } from "@/components/EmptyState";
import type { DigestPipelineRuntimeMetadata } from "@/lib/digest-pipeline-metadata";

export type HubDigestPipeline = {
  id: string;
  title: string;
  description: string | null;
  ownerUserId: string;
  ownerLabel: string;
  importCount: number;
  viewCount: number;
  digestCount: number;
  latestDigestAt: string | null;
  imported: boolean;
  owned: boolean;
} & DigestPipelineRuntimeMetadata;

export type OwnDigestPipeline = Pick<
  HubDigestPipeline,
  | "digestCount"
  | "digestUpdateStatus"
  | "frequencyLabel"
  | "importCount"
  | "latestDigestAt"
  | "latestDigestLanguage"
  | "summaryLanguage"
  | "title"
  | "viewCount"
>;

type DigestPipelinePreviewData = Pick<
  HubDigestPipeline,
  | "digestCount"
  | "digestUpdateStatus"
  | "frequencyLabel"
  | "latestDigestAt"
  | "latestDigestLanguage"
  | "summaryLanguage"
>;

type DigestPipelineImportFormProps = {
  pipelines: HubDigestPipeline[];
};

export function DigestPipelineImportForm({
  pipelines,
}: DigestPipelineImportFormProps) {
  const sharedPipelines = pipelines.filter((pipeline) => !pipeline.owned);
  const [importedIds, setImportedIds] = useState<Set<string>>(
    () =>
      new Set(
        sharedPipelines
          .filter((pipeline) => pipeline.imported)
          .map((pipeline) => pipeline.id),
      ),
  );
  const [pendingAction, setPendingAction] = useState<{
    pipelineId: string;
    type: "import" | "remove";
  } | null>(null);
  const [importPending, startImportTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function importPipeline(pipelineId: string) {
    if (pendingAction) return;
    const pipeline = pipelines.find((item) => item.id === pipelineId);
    if (!pipeline || pipeline.owned || importedIds.has(pipelineId)) return;
    setError(null);
    setPendingAction({ pipelineId, type: "import" });
    setImportedIds((current) => new Set([...current, pipelineId]));

    startImportTransition(async () => {
      try {
        const response = await fetch("/api/digest-pipelines/imports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId }),
        });
        if (!response.ok) throw new Error("Unable to import digest");
      } catch {
        setImportedIds((current) => {
          const next = new Set(current);
          next.delete(pipelineId);
          return next;
        });
        setError("Could not import digest.");
      } finally {
        setPendingAction(null);
      }
    });
  }

  function removeImported(pipelineId: string) {
    if (pendingAction) return;
    const pipeline = pipelines.find((item) => item.id === pipelineId);
    if (!pipeline || pipeline.owned || !importedIds.has(pipelineId)) return;
    setError(null);
    setPendingAction({ pipelineId, type: "remove" });
    setImportedIds((current) => {
      const next = new Set(current);
      next.delete(pipelineId);
      return next;
    });

    startImportTransition(async () => {
      try {
        const response = await fetch(`/api/digest-pipelines/imports/${pipelineId}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error("Unable to remove digest import");
      } catch {
        setImportedIds((current) => new Set([...current, pipelineId]));
        setError("Could not remove imported digest.");
      } finally {
        setPendingAction(null);
      }
    });
  }

  return (
    <section>
      <div className="library-hub-toolbar">
        <div className="library-hub-toolbar-copy">
          <h2 className="fb-section-heading">Shared AI Digests</h2>
          <p className="hub-section-copy">
            Import another user&apos;s latest digest and archive.
          </p>
        </div>
      </div>

      {error ? (
        <p className="hub-form-error" role="status">
          {error}
        </p>
      ) : null}

      <div className="hub-list-stack fb-hub-list">
        {sharedPipelines.map((pipeline) => (
          <DigestPipelineCard
            imported={importedIds.has(pipeline.id)}
            isPending={importPending}
            key={pipeline.id}
            onImport={importPipeline}
            onRemove={removeImported}
            pending={pendingAction?.pipelineId === pipeline.id ? pendingAction.type : null}
            pipeline={pipeline}
          />
        ))}
        {sharedPipelines.length === 0 ? (
          <EmptyState
            body="No shared digests are available yet."
            className="hub-list-empty"
          />
        ) : null}
      </div>
    </section>
  );
}

export function OwnDigestPipelineCard({
  beforePreview,
  children,
  cronStatusControl,
  pipeline,
}: {
  beforePreview?: ReactNode;
  children?: ReactNode;
  cronStatusControl?: ReactNode;
  pipeline: OwnDigestPipeline;
}) {
  return (
    <article className="own-digest-card">
      <div className="own-digest-card-head">
        <DigestPipelineTitleEditor
          className="fb-hub-title"
          headingId="sources-digest-title"
          headingLevel={3}
          initialTitle={pipeline.title}
        />
      </div>

      {beforePreview}

      <DigestPipelinePreviewCard
        cronStatusControl={cronStatusControl}
        pipeline={pipeline}
      />

      {children}

      <div className="fb-hub-card-stats">
        <CountMeta label={pipeline.importCount === 1 ? "import" : "imports"} value={pipeline.importCount} />
        <CountMeta label={pipeline.viewCount === 1 ? "view" : "views"} value={pipeline.viewCount} />
      </div>
    </article>
  );
}

function DigestPipelineCard({
  imported,
  isPending,
  onImport,
  onRemove,
  pending,
  pipeline,
}: {
  imported: boolean;
  isPending: boolean;
  onImport: (id: string) => void;
  onRemove: (id: string) => void;
  pending: "import" | "remove" | null;
  pipeline: HubDigestPipeline;
}) {
  const action = imported ? (
    <div className="hub-card-action-row">
      <span className="fb-chip success">
        <CheckCircle2 aria-hidden="true" />
        {pending === "import" ? "Importing" : "Imported"}
      </span>
      {pending === "import" ? null : (
        <button
          aria-busy={pending === "remove" && isPending}
          aria-label={`Remove ${pipeline.title} import`}
          className="fb-btn ghost compact hub-card-action-button"
          disabled={pending !== null}
          onClick={() => onRemove(pipeline.id)}
          type="button"
        >
          <Trash2 aria-hidden="true" />
          {pending === "remove" ? "Removing" : "Remove"}
        </button>
      )}
    </div>
  ) : (
    <button
      aria-busy={pending === "import" && isPending}
      aria-label={`Import ${pipeline.title}`}
      className="fb-btn dark compact hub-card-action-button"
      disabled={pending !== null}
      onClick={() => onImport(pipeline.id)}
      type="button"
    >
      <Download aria-hidden="true" />
      {pending === "import" ? "Importing" : "Import"}
    </button>
  );

  return (
    <article className="fb-hub-card">
      <div>
        <div className="fb-hub-card-head">
          <div className="fb-hub-card-titleblock">
            <h3 className="fb-hub-title">
              {pipeline.title}
            </h3>
          </div>
          <div className="fb-hub-card-actions">{action}</div>
        </div>

        <p className="fb-hub-card-desc">
          {pipeline.description || pipeline.ownerLabel}
        </p>
      </div>

      <DigestPipelinePreviewCard pipeline={pipeline} />

      <div className="fb-hub-card-stats">
        <CountMeta label={pipeline.importCount === 1 ? "import" : "imports"} value={pipeline.importCount} />
        <CountMeta label={pipeline.viewCount === 1 ? "view" : "views"} value={pipeline.viewCount} />
      </div>
    </article>
  );
}

export function DigestPipelinePreviewCard({
  cronStatusControl,
  pipeline,
}: {
  cronStatusControl?: ReactNode;
  pipeline: DigestPipelinePreviewData;
}) {
  return (
    <div className="fb-hub-digest-preview">
      <div className="fb-hub-digest-preview-row">
        <Radio className="fb-hub-digest-preview-icon" aria-hidden="true" />
        <div>
          <div className="fb-hub-digest-preview-title">
            {pipeline.latestDigestAt
              ? `Latest digest ${formatDate(pipeline.latestDigestAt)}`
              : "No digests yet"}
          </div>
          <div className="fb-hub-digest-count">
            <CountMeta
              label={pipeline.digestCount === 1 ? "saved digest" : "saved digests"}
              value={pipeline.digestCount}
            />
          </div>
        </div>
      </div>
      <DigestPipelineMetaGrid cronStatusControl={cronStatusControl} pipeline={pipeline} />
    </div>
  );
}

function DigestPipelineMetaGrid({
  cronStatusControl,
  pipeline,
}: {
  cronStatusControl?: ReactNode;
  pipeline: DigestPipelinePreviewData;
}) {
  const status = pipeline.digestUpdateStatus;
  return (
    <dl className="fb-hub-digest-meta" aria-label="Digest pipeline details">
      <DigestPipelineMetaItem
        label="Update frequency"
        value={pipeline.frequencyLabel ?? "Not scheduled"}
      />
      <DigestPipelineMetaItem
        label="Language"
        value={formatLanguage(pipeline.summaryLanguage ?? pipeline.latestDigestLanguage ?? "zh")}
      />
      <DigestPipelineMetaItem
        label="Latest digest"
        value={pipeline.latestDigestAt ? formatDate(pipeline.latestDigestAt) : "None yet"}
      />
      <div className="fb-hub-digest-meta-item">
        <dt>Cron status</dt>
        <dd>
          {cronStatusControl ?? (
            <span className={`fb-hub-digest-status is-${status.key}`}>
              {status.label}
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}

function DigestPipelineMetaItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="fb-hub-digest-meta-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatLanguage(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "chinese") return "Chinese";
  if (normalized === "en" || normalized === "en-us" || normalized === "english") return "English";
  return value.toUpperCase();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
