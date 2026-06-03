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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="fb-kind-pill">digest</span>
              <span className="text-[11px] text-[var(--muted)]">· Shared archive</span>
            </div>
            <h3 className="fb-hub-title mt-2">
              {pipeline.title}
            </h3>
          </div>
          {action}
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted-strong)]">
          {pipeline.description || pipeline.ownerLabel}
        </p>
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-3 text-sm text-[var(--muted-strong)]">
        <div className="flex items-start gap-2">
          <Radio className="mt-0.5 h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
          <div>
            <div className="font-semibold text-[var(--ink)]">
              {pipeline.latestDigestAt
                ? `Latest digest ${formatDate(pipeline.latestDigestAt)}`
                : "No digests yet"}
            </div>
            <div className="mt-1 text-xs">
              <CountMeta
                label={pipeline.digestCount === 1 ? "saved digest" : "saved digests"}
                value={pipeline.digestCount}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] pt-3 text-[11.5px] font-semibold text-[var(--muted)]">
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
