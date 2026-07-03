"use client";

import { useState } from "react";
import {
  CloudSourceLogItem,
  type CloudSourceLogSource,
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

export function AdminCloudLibraryExplorer({
  libraries,
}: {
  libraries: CloudLibraryOverview[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

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
                return (
                  <CloudSourceLogItem
                    key={source.builderId}
                    isOpen={isOpen}
                    onToggle={() => setExpanded(isOpen ? null : source.builderId)}
                    showSubmitters={false}
                    source={toCloudSourceLogItem(source)}
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

function toCloudSourceLogItem(source: CloudLibrarySource): CloudSourceLogSource {
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
      `${source.postCount} ${source.postCount === 1 ? "post" : "posts"}`,
    ],
    lastSuccessAt: source.lastSuccessAt,
    lastFailureAt: source.lastFailureAt,
    lastFailureReason: source.lastFailureReason,
    nextAttemptAt: source.nextAttemptAt,
    circuitBreakerUntil: source.circuitBreakerUntil,
    latestRunTask: source.latestRunTask,
  };
}
