"use client";

import { useCallback, useState } from "react";
import {
  CloudSourceLogItem,
  type CloudSourceLogSource,
  type CloudSourceLogSubmitter,
} from "@/components/CloudSourceLogItem";
import type {
  CloudLibraryOverview,
  CloudLibrarySource,
} from "@/lib/cloud-library-overview";

function statusTone(status: string): string {
  if (status === "ACTIVE") return "active";
  if (status === "PAUSED") return "paused";
  return "error";
}

function frequencyLabel(frequency: string): string {
  if (frequency === "DAILY") return "Daily";
  if (frequency === "WEEKLY") return "Weekly";
  return frequency;
}

type SourceDrill = {
  submitters: CloudSourceLogSubmitter[];
};

type SourceDrillResponse = {
  error?: string;
  submitters?: CloudSourceLogSubmitter[];
};

export function AdminCloudLibraryExplorer({
  libraries,
}: {
  libraries: CloudLibraryOverview[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drill, setDrill] = useState<Record<string, SourceDrill>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const loadSource = useCallback(
    async (builderId: string) => {
      if (drill[builderId] || loading === builderId) return;

      setLoading(builderId);
      try {
        const response = await fetch(`/api/admin/cloud-fetch/sources/${builderId}`, {
          cache: "no-store",
        });
        const body = (await response.json().catch(() => null)) as SourceDrillResponse | null;
        if (!response.ok) {
          throw new Error(body?.error ?? "Failed to load cloud source details");
        }
        setDrill((current) => ({
          ...current,
          [builderId]: {
            submitters: Array.isArray(body?.submitters) ? body.submitters : [],
          },
        }));
      } catch (error) {
        console.error(error);
      } finally {
        setLoading((current) => (current === builderId ? null : current));
      }
    },
    [drill, loading],
  );

  const toggleSource = useCallback(
    (builderId: string) => {
      const shouldOpen = expanded !== builderId;
      setExpanded(shouldOpen ? builderId : null);
      if (shouldOpen) {
        void loadSource(builderId);
      }
    },
    [expanded, loadSource],
  );

  if (libraries.length === 0) {
    return <p className="cron-field-hint">No cloud language libraries configured yet.</p>;
  }

  return (
    <div className="cloud-library-explorer">
      {libraries.map((library) => (
        <section key={library.id} className="cloud-library-group">
          <header className="cloud-library-group-head">
            <span className="cloud-library-group-lang">{library.summaryLanguage}</span>
            {library.ownerEmail ? (
              <span className="cloud-library-group-owner">{library.ownerEmail}</span>
            ) : null}
            <span className="cloud-library-group-count">
              {library.sourceCount} {library.sourceCount === 1 ? "source" : "sources"}
            </span>
            {library.enabled ? null : (
              <span className="cloud-status-chip is-paused">disabled</span>
            )}
          </header>

          {library.sources.length === 0 ? (
            <p className="cron-field-hint">No sources in this library yet.</p>
          ) : (
            <ul className="cloud-source-list">
              {library.sources.map((source) => {
                const isOpen = expanded === source.builderId;
                const detail = drill[source.builderId];
                return (
                  <CloudSourceLogItem
                    key={source.builderId}
                    isOpen={isOpen}
                    onToggle={() => toggleSource(source.builderId)}
                    showSubmitters={true}
                    source={toCloudSourceLogItem(source, detail)}
                  />
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function toCloudSourceLogItem(
  source: CloudLibrarySource,
  detail?: SourceDrill,
): CloudSourceLogSource {
  return {
    id: source.builderId,
    cloudBuilderId: source.builderId,
    feedBuilderId: source.builderId,
    entityId: source.entityId,
    kind: source.kind,
    sourceName: source.sourceName,
    sourceType: source.sourceType,
    sourceUrl: source.sourceUrl,
    fetchUrl: source.fetchUrl,
    avatarUrl: source.avatarUrl,
    avatarDataUrl: source.avatarDataUrl,
    postCount: source.postCount,
    statusChipLabel: source.status,
    statusChipClassName: `is-${statusTone(source.status)}`,
    metaItems: [
      frequencyLabel(source.effectiveFrequency),
      `${source.submitterCount} ${source.submitterCount === 1 ? "submitter" : "submitters"}`,
      `${source.postCount} ${source.postCount === 1 ? "post" : "posts"}`,
    ],
    lastSuccessAt: source.lastSuccessAt,
    lastFailureAt: source.lastFailureAt,
    lastFailureReason: source.lastFailureReason,
    nextAttemptAt: source.nextAttemptAt,
    circuitBreakerUntil: source.circuitBreakerUntil,
    latestRunTask: source.latestRunTask,
    submitterCount: source.submitterCount,
    submitters: detail?.submitters,
  };
}
