"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CheckCircle2, Download } from "lucide-react";
import Link from "next/link";
import { CountMeta, CountRange, formatCount } from "@/components/Count";
import { DigestHeadlineSummary } from "@/components/DigestHeadlineSummary";
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
  | "latestDigestSourceLinks"
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
  | "latestDigestSourceLinks"
  | "summaryLanguage"
>;

type DigestPipelineImportFormProps = {
  mode?: "hub" | "imported";
  pipelines: HubDigestPipeline[];
};

const HUB_DIGEST_HEADLINE_LINES = 6;

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
    mode === "imported" ? "Imported AI Digest collections" : "Shared AI Digest collections";
  const description =
    mode === "imported"
      ? "Already in the AI Digest tab."
      : "Import shared AI Digest collections into the AI Digest tab.";
  const emptyTitle =
    mode === "imported"
      ? "No imported AI Digest collections"
      : "No shared AI Digest collections";
  const emptyMessage =
    mode === "imported"
      ? "Import one to see it in the AI Digest tab."
      : "AI Digest collections appear here after users share them to Hub.";

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
        if (!response.ok) throw new Error("Could not import AI Digest collection.");
      } catch {
        setImportedIds((current) => {
          const next = new Set(current);
          next.delete(pipelineId);
          return next;
        });
        setError("Could not import AI Digest collection.");
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
        if (!response.ok) throw new Error("Could not remove AI Digest collection import.");
      } catch {
        setImportedIds((current) => new Set([...current, pipelineId]));
        setError("Could not remove AI Digest collection import.");
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
            ? "AI Digest collection"
            : "AI Digest collections"}
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
                  Browse AI Digest collections
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
              Remove AI Digest collection import?
            </h3>
            <div className="settings-dialog-copy">
              <p>
                After removing <strong>{removeTarget.title}</strong>, you will
                no longer see this collection in the AI Digest tab.
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
        detailsSlot={children}
        pipeline={pipeline}
      />

      <div className="fb-hub-card-stats">
        <CountMeta
          label={pipeline.digestCount === 1 ? "issue" : "issues"}
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
    <button
      aria-busy={pending === "remove" && isPending}
      aria-label={`Remove ${pipeline.title} AI Digest collection import`}
      className="fb-btn light compact hub-card-action-button is-imported"
      disabled={isPending || pending !== null}
      onClick={() => onRemove(pipeline.id)}
      type="button"
    >
      <CheckCircle2 aria-hidden="true" />
      {pending === "remove" ? "Removing" : "Imported"}
    </button>
  ) : (
    <button
      aria-busy={pending === "import" && isPending}
      aria-label={`Import AI Digest collection ${pipeline.title}`}
      className="fb-btn dark compact hub-card-action-button"
      disabled={isPending || pending !== null}
      onClick={() => onImport(pipeline.id)}
      type="button"
    >
      <Download aria-hidden="true" />
      {pending === "import" ? "Importing collection" : "Import collection"}
    </button>
  );
  const description = digestPipelineCardDescription(pipeline);

  return (
    <article className="fb-hub-card digest-pipeline-card">
      <div>
        <div className="fb-hub-card-head">
          <div className="fb-hub-card-titleblock">
            <h3 className="fb-hub-title">
              {pipeline.title}
            </h3>
            <p className="fb-hub-card-byline">
              {digestPipelineByline(pipeline.ownerLabel)}
            </p>
          </div>
          <div
            aria-label={`AI Digest collection actions for ${pipeline.title}`}
            className="fb-hub-card-actions"
            role="group"
          >
            {action}
          </div>
        </div>

        {description ? (
          <p className="fb-hub-card-desc">
            {description}
          </p>
        ) : null}
      </div>

      <DigestPipelinePreviewCard pipeline={pipeline} />

      <div className="fb-hub-card-stats">
        <CountMeta
          label={pipeline.digestCount === 1 ? "issue" : "issues"}
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
  return null;
}

function digestPipelineByline(ownerLabel: string) {
  const label = ownerLabel
    .trim()
    .replace(/^Shared by\s+/i, "")
    .replace(/[.。]+$/u, "");
  if (/^Curated by\s+/i.test(label)) return label;
  return `By ${label || "a FollowBrief user"}`;
}

export function DigestPipelinePreviewCard({
  cronStatusControl,
  detailsSlot,
  pipeline,
}: {
  cronStatusControl?: ReactNode;
  detailsSlot?: ReactNode;
  pipeline: DigestPipelinePreviewData;
}) {
  const headline = pipeline.latestDigestHeadline?.trim();

  return (
    <div className="fb-hub-digest-preview">
      <DigestPipelineMetaGrid cronStatusControl={cronStatusControl} pipeline={pipeline} />
      {detailsSlot}
      <div className="fb-hub-digest-preview-row">
        <div>
          {headline ? (
            <DigestHeadlineSummary
              collapsedLineCount={HUB_DIGEST_HEADLINE_LINES}
              sourceLinks={pipeline.latestDigestSourceLinks}
              text={headline}
            />
          ) : (
            <div className="fb-hub-digest-preview-title">No AI Digest issues yet</div>
          )}
        </div>
      </div>
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
        label="Latest issue"
        value={pipeline.latestDigestAt ? formatDate(pipeline.latestDigestAt) : "None yet"}
      />
      <div className="fb-hub-digest-meta-item">
        <dt>Status / log</dt>
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
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}
