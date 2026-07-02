"use client";

import { useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import { BuilderFeedItems } from "@/components/BuilderFeedItems";
import { RelativeTime } from "@/components/RelativeTime";
import { SourceAvatar } from "@/components/SourceAvatar";
import type {
  CloudLibraryOverview,
  CloudLibrarySource,
  CloudSourceSubmitter,
} from "@/lib/cloud-library-overview";

type Drill = { submitters: CloudSourceSubmitter[] };

type BuilderKind = "X" | "BLOG" | "PODCAST" | "WEBSITE";

function toBuilderKind(kind: string | null): BuilderKind {
  if (kind === "X" || kind === "BLOG" || kind === "PODCAST" || kind === "WEBSITE") return kind;
  return "BLOG";
}

// Shape BuilderFeedItems (the shared per-source recent-posts component) expects.
function builderSummary(source: CloudLibrarySource) {
  return {
    id: source.builderId,
    entityId: source.entityId,
    name: source.sourceName ?? source.builderId,
    kind: toBuilderKind(source.kind),
    sourceType: source.sourceType ?? "website",
    sourceUrl: source.sourceUrl,
    fetchUrl: source.fetchUrl,
  };
}

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

function avatarSource(source: CloudLibrarySource) {
  return {
    avatarDataUrl: source.avatarDataUrl,
    avatarUrl: source.avatarUrl,
    fetchUrl: source.fetchUrl,
    name: source.sourceName ?? source.builderId,
    sourceType: source.sourceType ?? "website",
    sourceUrl: source.sourceUrl,
  };
}

export function AdminCloudLibraryExplorer({
  libraries,
}: {
  libraries: CloudLibraryOverview[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drill, setDrill] = useState<Record<string, Drill>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    async (builderId: string) => {
      if (expanded === builderId) {
        setExpanded(null);
        return;
      }
      setExpanded(builderId);
      if (drill[builderId]) return;
      setLoading(builderId);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/cloud-fetch/sources/${encodeURIComponent(builderId)}`,
          { headers: { accept: "application/json" } },
        );
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(body?.error ?? "Could not load source detail.");
          return;
        }
        setDrill((current) => ({
          ...current,
          [builderId]: {
            submitters: Array.isArray(body?.submitters) ? body.submitters : [],
          },
        }));
      } catch {
        setError("Could not load source detail.");
      } finally {
        setLoading(null);
      }
    },
    [expanded, drill],
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
                  <li key={source.builderId} className="cloud-source-item">
                    <button
                      type="button"
                      className="cloud-source-head"
                      aria-expanded={isOpen}
                      onClick={() => toggle(source.builderId)}
                    >
                      <SourceAvatar
                        className="builder-library-avatar"
                        imageSize={40}
                        source={avatarSource(source)}
                      />
                      <span className="builder-library-info">
                        <span className="builder-library-info-head">
                          <span className="builder-library-name">
                            {source.sourceName ?? source.builderId}
                          </span>
                        </span>
                        <span className="builder-library-meta">
                          <span>{frequencyLabel(source.effectiveFrequency)}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {source.submitterCount}{" "}
                            {source.submitterCount === 1 ? "submitter" : "submitters"}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {source.postCount} {source.postCount === 1 ? "post" : "posts"}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className={`cloud-status-chip is-${statusTone(source.status)}`}>
                            {source.status}
                          </span>
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className="cloud-source-chevron"
                        data-open={isOpen ? "true" : undefined}
                      />
                    </button>

                    {isOpen ? (
                      <div className="cloud-source-detail">
                        <p className="cloud-source-status-line">
                          Last success <RelativeTime value={source.lastSuccessAt} fallback="—" /> · Last failure{" "}
                          <RelativeTime value={source.lastFailureAt} fallback="—" />
                          {source.lastFailureReason ? ` (${source.lastFailureReason})` : ""} · Next
                          attempt <RelativeTime value={source.nextAttemptAt} fallback="—" />
                          {source.circuitBreakerUntil ? (
                            <>
                              {" · "}circuit-broken until{" "}
                              <RelativeTime value={source.circuitBreakerUntil} fallback="—" />
                            </>
                          ) : null}
                        </p>

                        {loading === source.builderId ? (
                          <p className="cron-field-hint">Loading…</p>
                        ) : detail ? (
                          <>
                            <p className="cloud-source-detail-label">
                              Submitters ({detail.submitters.length})
                            </p>
                            {detail.submitters.length === 0 ? (
                              <p className="cron-field-hint">No active submitters.</p>
                            ) : (
                              <ul className="cloud-source-submitters">
                                {detail.submitters.map((submitter, index) => (
                                  <li key={submitter.email ?? `submitter-${index}`}>
                                    <span className="cloud-source-submitter-id">
                                      {submitter.email ?? submitter.name ?? "unknown"}
                                    </span>
                                    <span className="cloud-source-submitter-freq">
                                      {frequencyLabel(submitter.frequency)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}

                            <p className="cloud-source-detail-label">Recent posts</p>
                            <BuilderFeedItems
                              builder={builderSummary(source)}
                              builderId={source.builderId}
                              isOpen
                              listId={`cloud-posts-${source.builderId}`}
                              totalCount={source.postCount}
                            />
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
      {error ? <p className="cron-field-error">{error}</p> : null}
    </div>
  );
}
