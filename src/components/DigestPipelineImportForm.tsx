"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Download, Radio, Trash2 } from "lucide-react";
import { CountMeta } from "@/components/Count";

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
};

type DigestPipelineImportFormProps = {
  pipelines: HubDigestPipeline[];
};

export function DigestPipelineImportForm({
  pipelines,
}: DigestPipelineImportFormProps) {
  const [importedIds, setImportedIds] = useState<Set<string>>(
    () => new Set(pipelines.filter((pipeline) => pipeline.imported).map((pipeline) => pipeline.id)),
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
        <div>
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
        {pipelines.map((pipeline) => (
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
        {pipelines.length === 0 ? (
          <div className="fb-panel dashed col-span-full text-sm text-[var(--muted-strong)]">
            No shared digests are available yet.
          </div>
        ) : null}
      </div>
    </section>
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
  const action = pipeline.owned ? (
    <span className="fb-chip success">
      <CheckCircle2 aria-hidden="true" />
      Your digest
    </span>
  ) : imported ? (
    <div className="flex flex-wrap items-center gap-2">
      <span className="fb-chip success">
        <CheckCircle2 aria-hidden="true" />
        {pending === "import" ? "Importing" : "Imported"}
      </span>
      {pending === "import" ? null : (
        <button
          aria-busy={pending === "remove" && isPending}
          aria-label={`Remove ${pipeline.title} import`}
          className="fb-btn ghost compact disabled:cursor-wait"
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
      className="fb-btn dark compact disabled:cursor-wait"
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
            <div className="fb-hub-card-kicker">
              <span className="fb-kind-pill">digest</span>
              <span className="fb-hub-card-topic">· Shared archive</span>
            </div>
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
      </div>

      <div className="fb-hub-card-stats">
        <CountMeta label={pipeline.importCount === 1 ? "import" : "imports"} value={pipeline.importCount} />
        <CountMeta label={pipeline.viewCount === 1 ? "view" : "views"} value={pipeline.viewCount} />
      </div>
    </article>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
