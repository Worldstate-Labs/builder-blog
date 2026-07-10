"use client";

import { useMemo, useState } from "react";
import { CountBadge, formatCount } from "@/components/Count";
import { RelativeTime } from "@/components/RelativeTime";
import { SourceAvatar } from "@/components/SourceAvatar";
import {
  type AdminBackupSourceCandidate,
  type AdminSourceCandidate,
} from "@/lib/source-candidate-backup";
import { sourceCandidateValue } from "@/lib/source-candidates";
import { sourceLabelForType } from "@/lib/source-display";

type CandidateTab = "primary" | "backup";
type CandidateRow = AdminSourceCandidate | AdminBackupSourceCandidate;

export function AdminSourceCandidateLibraries({
  backupCandidates,
  sourceCandidates,
}: {
  backupCandidates: AdminBackupSourceCandidate[];
  sourceCandidates: AdminSourceCandidate[];
}) {
  const [activeTab, setActiveTab] = useState<CandidateTab>("primary");
  const [query, setQuery] = useState("");
  const rows = activeTab === "primary" ? sourceCandidates : backupCandidates;
  const visibleRows = useMemo(
    () => rows.filter((candidate) => candidateMatchesQuery(candidate, query)),
    [query, rows],
  );
  const emptyLabel =
    query.trim()
      ? "No sources match this filter."
      : activeTab === "primary"
        ? "No primary candidates yet."
        : "No backup candidates yet.";

  return (
    <div className="source-candidate-admin-panel">
      <div className="source-candidate-admin-toolbar">
        <div
          aria-label="Source candidate library"
          className="fb-segmented-tabs source-candidate-admin-tabs"
          role="tablist"
        >
          <button
            aria-controls="source-candidate-admin-list"
            aria-selected={activeTab === "primary"}
            className="fb-btn compact"
            onClick={() => setActiveTab("primary")}
            role="tab"
            type="button"
          >
            <span>Primary candidates</span>
            <CountBadge value={sourceCandidates.length} />
          </button>
          <button
            aria-controls="source-candidate-admin-list"
            aria-selected={activeTab === "backup"}
            className="fb-btn compact"
            onClick={() => setActiveTab("backup")}
            role="tab"
            type="button"
          >
            <span>Backup candidates</span>
            <CountBadge value={backupCandidates.length} />
          </button>
        </div>

        <label className="source-candidate-admin-search">
          <span>Filter</span>
          <input
            autoComplete="off"
            className="settings-input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, type, or URL"
            spellCheck={false}
            type="search"
            value={query}
          />
        </label>
      </div>

      {visibleRows.length === 0 ? (
        <p className="cron-field-hint">{emptyLabel}</p>
      ) : (
        <ul
          aria-label={
            activeTab === "primary"
              ? "Primary source candidates"
              : "Backup source candidates"
          }
          className="source-candidate-admin-list"
          id="source-candidate-admin-list"
          role="list"
        >
          {visibleRows.map((candidate) => (
            <li className="source-candidate-admin-row" key={candidate.id}>
              <SourceAvatar
                className="source-candidate-admin-avatar"
                imageSize={36}
                source={candidate}
              />
              <div className="source-candidate-admin-main">
                <div className="source-candidate-admin-title-line">
                  <strong>{candidate.name}</strong>
                  <span className="cloud-status-chip is-muted">
                    {sourceLabelForType(candidate.sourceType)}
                  </span>
                </div>
                <span className="source-candidate-admin-url">
                  {candidateValue(candidate)}
                </span>
              </div>
              <div className="source-candidate-admin-facts">
                {activeTab === "backup" && isBackupCandidate(candidate) ? (
                  <>
                    <span>{formatCount(candidate.seenCount)} seen</span>
                    <span>
                      Last seen <RelativeTime value={candidate.lastSeenAt} />
                    </span>
                  </>
                ) : (
                  <>
                    <span>{primarySeedLabel(candidate as AdminSourceCandidate)}</span>
                    <span>
                      Updated <RelativeTime value={candidate.updatedAt} />
                    </span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function candidateMatchesQuery(candidate: CandidateRow, query: string) {
  const normalizedQuery = normalizeCandidateQuery(query);
  if (!normalizedQuery) return true;
  return [
    candidate.name,
    candidate.sourceType,
    candidate.sourceUrl,
    candidate.fetchUrl,
    candidate.handle,
    candidate.sourceKey,
    candidateValue(candidate),
  ].some((value) => normalizeCandidateQuery(value).includes(normalizedQuery));
}

function candidateValue(candidate: CandidateRow) {
  return sourceCandidateValue(candidate) || candidate.sourceKey;
}

function isBackupCandidate(candidate: CandidateRow): candidate is AdminBackupSourceCandidate {
  return "seenCount" in candidate;
}

function primarySeedLabel(candidate: AdminSourceCandidate) {
  return candidate.seededFrom?.replaceAll("_", " ") ?? "source candidate";
}

function normalizeCandidateQuery(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^@/, "");
}
