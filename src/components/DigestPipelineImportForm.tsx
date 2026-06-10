"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CheckCircle2, Download, Radio, Trash2 } from "lucide-react";
import Link from "next/link";
import { CountMeta, CountRange, formatCount } from "@/components/Count";
import { DigestPipelineTitleEditor } from "@/components/DigestPipelineTitleEditor";
import { EmptyState } from "@/components/EmptyState";
import type { DigestPipelineRuntimeMetadata } from "@/lib/digest-pipeline-metadata";
import { displayLanguagePreference } from "@/lib/language-preference";

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
  | "latestDigestHeadline"
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
  | "latestDigestHeadline"
  | "latestDigestLanguage"
  | "summaryLanguage"
>;

type DigestPipelineImportFormProps = {
  mode?: "hub" | "imported";
  pipelines: HubDigestPipeline[];
};

export function DigestPipelineImportForm({
  mode = "hub",
  pipelines,
}: DigestPipelineImportFormProps) {
  const sharedPipelines = useMemo(
    () => pipelines.filter((pipeline) => !pipeline.owned),
    [pipelines],
  );
  const importedSignature = useMemo(
    () =>
      sharedPipelines
        .filter((pipeline) => pipeline.imported)
        .map((pipeline) => pipeline.id)
        .sort()
        .join("|"),
    [sharedPipelines],
  );
  const propImportedIds = useMemo(
    () =>
      new Set(
        sharedPipelines
          .filter((pipeline) => pipeline.imported)
          .map((pipeline) => pipeline.id),
      ),
    [sharedPipelines],
  );
  const [importedState, setImportedState] = useState<{
    ids: Set<string>;
    key: string;
  }>({
    ids: propImportedIds,
    key: importedSignature,
  });
  const importedIds =
    importedState.key === importedSignature ? importedState.ids : propImportedIds;
  const importedPipelines = sharedPipelines.filter((pipeline) =>
    importedIds.has(pipeline.id),
  );
  const visiblePipelines = mode === "imported" ? importedPipelines : sharedPipelines;
  const title =
    mode === "imported" ? "Imported AI Digest archives" : "Shared AI Digest archives";
  const description =
    mode === "imported"
      ? "AI Digest archives from Hub that are already available in Home AI Digest."
      : "AI Digest archives built and shared by other users.";
  const emptyTitle =
    mode === "imported"
      ? "No imported AI Digest archives"
      : "No shared AI Digest archives";
  const emptyMessage =
    mode === "imported"
      ? "Import AI Digest archives built and shared by other users to see them in Home AI Digest."
      : "Shared AI Digest archives will appear here once users share them to Hub.";

  function setImportedIds(updater: (current: Set<string>) => Set<string>) {
    setImportedState((current) => {
      const currentIds =
        current.key === importedSignature ? current.ids : propImportedIds;
      return {
        ids: updater(currentIds),
        key: importedSignature,
      };
    });
  }
  const [pendingAction, setPendingAction] = useState<{
    pipelineId: string;
    type: "import" | "remove";
  } | null>(null);
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const [importPending, startImportTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const removeTarget = removeTargetId
    ? pipelines.find((pipeline) => pipeline.id === removeTargetId) ?? null
    : null;

  useEffect(() => {
    const dialog = removeDialogRef.current;
    if (!dialog) return;
    if (removeTarget) {
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (dialog.open) dialog.close();
  }, [removeTarget]);

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
        if (!response.ok) throw new Error("Unable to import AI Digest archive");
      } catch {
        setImportedIds((current) => {
          const next = new Set(current);
          next.delete(pipelineId);
          return next;
        });
        setError("Could not import AI Digest archive.");
      } finally {
        setPendingAction(null);
      }
    });
  }

  function requestRemoveImported(pipelineId: string) {
    if (pendingAction) return;
    const pipeline = pipelines.find((item) => item.id === pipelineId);
    if (!pipeline || pipeline.owned || !importedIds.has(pipelineId)) return;
    setError(null);
    setRemoveTargetId(pipelineId);
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
        if (!response.ok) throw new Error("Unable to remove AI Digest archive import");
      } catch {
        setImportedIds((current) => new Set([...current, pipelineId]));
        setError("Could not remove AI Digest archive import.");
      } finally {
        setPendingAction(null);
      }
    });
  }

  function closeRemoveDialog() {
    if (removeDialogRef.current?.open) {
      removeDialogRef.current.close();
    }
    setRemoveTargetId(null);
  }

  function handleRemoveDialogClose() {
    setRemoveTargetId(null);
  }

  function confirmRemoveImported() {
    if (!removeTargetId) return;
    const pipelineId = removeTargetId;
    closeRemoveDialog();
    removeImported(pipelineId);
  }

  return (
    <section>
      <div className="library-hub-toolbar">
        <div className="library-hub-toolbar-copy">
          <h2 className="fb-section-heading">{title}</h2>
          <p className="hub-section-copy">
            {description}
          </p>
        </div>
      </div>

      {error ? (
        <p className="hub-form-error" role="status">
          {error}
        </p>
      ) : null}

      <div className="hub-list-count-row at-desktop">
        <CountRange>
          {formatCount(visiblePipelines.length)}{" "}
          {visiblePipelines.length === 1
            ? "AI Digest archive"
            : "AI Digest archives"}
        </CountRange>
      </div>

      <div className="hub-list-stack fb-hub-list">
        {visiblePipelines.map((pipeline) => (
          <DigestPipelineCard
            imported={importedIds.has(pipeline.id)}
            isPending={importPending || pendingAction !== null}
            key={pipeline.id}
            onImport={importPipeline}
            onRemove={requestRemoveImported}
            pending={pendingAction?.pipelineId === pipeline.id ? pendingAction.type : null}
            pipeline={pipeline}
          />
        ))}
        {visiblePipelines.length === 0 ? (
          <EmptyState
            actions={
              mode === "imported" ? (
                <Link className="fb-btn light compact" href="/library-hub?tab=ai-digests">
                  Browse AI Digest archives
                </Link>
              ) : null
            }
            body={emptyMessage}
            className="hub-list-empty"
            title={emptyTitle}
          />
        ) : null}
      </div>

      <dialog
        aria-labelledby="hub-remove-ai-digest-title"
        className="fb-dialog"
        onClick={(event) => {
          if (event.target === removeDialogRef.current) closeRemoveDialog();
        }}
        onClose={handleRemoveDialogClose}
        ref={removeDialogRef}
      >
        {removeTarget ? (
          <div className="fb-dialog-inner settings-dialog-stack">
            <h3 className="fb-section-heading" id="hub-remove-ai-digest-title">
              Remove AI Digest archive import?
            </h3>
            <div className="settings-dialog-copy">
              <p>
                After removing <strong>{removeTarget.title}</strong>, you will
                no longer see this AI Digest archive in Home AI Digest.
              </p>
              <p className="settings-dialog-warning">
                You can import it again from Hub later.
              </p>
            </div>
            <div className="settings-dialog-actions">
              <button
                className="fb-btn light compact"
                onClick={closeRemoveDialog}
                type="button"
              >
                Cancel
              </button>
              <button
                className="fb-btn danger compact"
                onClick={confirmRemoveImported}
                type="button"
              >
                Remove import
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
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
        <CountMeta
          label={pipeline.digestCount === 1 ? "archive entry" : "archive entries"}
          value={pipeline.digestCount}
        />
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
  const action = imported && pending !== "import" ? (
    <>
      <span className="fb-chip hub-card-imported-status">
        <CheckCircle2 aria-hidden="true" />
        Imported
      </span>
      <button
        aria-busy={pending !== null && isPending}
        aria-label={`Remove ${pipeline.title} AI Digest archive import`}
        className="fb-btn light compact hub-card-remove-button digest-pipeline-remove-button"
        disabled={isPending || pending !== null}
        onClick={() => onRemove(pipeline.id)}
        type="button"
      >
        <Trash2 aria-hidden="true" />
        Remove import
      </button>
    </>
  ) : (
    <button
      aria-busy={pending === "import" && isPending}
      aria-label={`Import AI Digest archive ${pipeline.title}`}
      className="fb-btn dark compact hub-card-action-button"
      disabled={isPending || pending !== null}
      onClick={() => onImport(pipeline.id)}
      type="button"
    >
      <Download aria-hidden="true" />
      {pending === "import" ? "Importing archive" : "Import archive"}
    </button>
  );

  return (
    <article className="fb-hub-card digest-pipeline-card">
      <div>
        <div className="fb-hub-card-head">
          <div className="fb-hub-card-titleblock">
            <div className="fb-hub-card-kicker">
              <span className="fb-kind-pill">{digestPipelineKindBadge(pipeline)}</span>
              <span className="fb-hub-card-topic">· {digestPipelineOwnerTopic(pipeline.ownerLabel)}</span>
            </div>
            <h3 className="fb-hub-title">
              {pipeline.title}
            </h3>
          </div>
          <div
            aria-label={`AI Digest archive actions for ${pipeline.title}`}
            className="fb-hub-card-actions"
            role="group"
          >
            {action}
          </div>
        </div>

        <p className="fb-hub-card-desc">
          {digestPipelineCardDescription(pipeline)}
        </p>
      </div>

      <DigestPipelinePreviewCard pipeline={pipeline} />

      <div className="fb-hub-card-stats">
        <CountMeta
          label={pipeline.digestCount === 1 ? "archive entry" : "archive entries"}
          value={pipeline.digestCount}
        />
        <CountMeta label={pipeline.importCount === 1 ? "import" : "imports"} value={pipeline.importCount} />
        <CountMeta label={pipeline.viewCount === 1 ? "view" : "views"} value={pipeline.viewCount} />
      </div>
    </article>
  );
}

function digestPipelineCardDescription(pipeline: HubDigestPipeline) {
  const description = pipeline.description?.trim();
  if (description) return description;
  return `Shared by ${pipeline.ownerLabel}.`;
}

function digestPipelineKindBadge(pipeline: Pick<HubDigestPipeline, "ownerLabel">) {
  return pipeline.ownerLabel === "FollowBrief" ? "community" : "shared";
}

function digestPipelineOwnerTopic(ownerLabel: string) {
  return ownerLabel.trim() || "a FollowBrief user";
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
              ? `Latest AI Digest ${formatDate(pipeline.latestDigestAt)}`
              : "No AI Digest archive entries yet"}
          </div>
          {pipeline.latestDigestHeadline ? (
            <section
              aria-label="Latest AI Digest headline"
              className="fb-hub-digest-headline"
            >
              <div className="fb-hub-digest-headline-kicker">Headlines</div>
              <p>{pipeline.latestDigestHeadline}</p>
            </section>
          ) : null}
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
    <dl className="fb-hub-digest-meta" aria-label="AI Digest details">
      <DigestPipelineMetaItem
        label="Build frequency"
        value={pipeline.frequencyLabel ?? "Not scheduled"}
      />
      <DigestPipelineMetaItem
        label="Language"
        value={formatLanguage(pipeline.summaryLanguage ?? pipeline.latestDigestLanguage ?? "zh")}
      />
      <DigestPipelineMetaItem
        label="Latest AI Digest"
        value={pipeline.latestDigestAt ? formatDate(pipeline.latestDigestAt) : "None yet"}
      />
      <div className="fb-hub-digest-meta-item">
        <dt>Schedule status</dt>
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
  return displayLanguagePreference(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
