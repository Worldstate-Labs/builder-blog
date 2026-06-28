"use client";

import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  CloudLibraryOverview,
  CloudSourcePost,
  CloudSourceSubmitter,
} from "@/lib/cloud-library-overview";

type Drill = { submitters: CloudSourceSubmitter[]; posts: CloudSourcePost[] };

function statusClass(status: string): string {
  if (status === "ACTIVE") return "is-ok";
  if (status === "PAUSED") return "is-partial";
  return "is-failed";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
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
            posts: Array.isArray(body?.posts) ? body.posts : [],
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
        <div key={library.id} className="cloud-library-group">
          <h4 className="fb-section-title">
            {library.summaryLanguage}
            {library.ownerEmail ? ` · ${library.ownerEmail}` : ""}
            {library.enabled ? "" : " · disabled"}
            {` · ${library.sourceCount} ${library.sourceCount === 1 ? "source" : "sources"}`}
          </h4>
          {library.sources.length === 0 ? (
            <p className="cron-field-hint">No sources in this library yet.</p>
          ) : (
            <ul className="cloud-library-source-list">
              {library.sources.map((s) => {
                const isOpen = expanded === s.builderId;
                const detail = drill[s.builderId];
                return (
                  <li key={s.builderId} className="cloud-library-source">
                    <button
                      type="button"
                      className="cloud-library-source-head"
                      aria-expanded={isOpen}
                      onClick={() => toggle(s.builderId)}
                    >
                      <span aria-hidden="true">{isOpen ? <ChevronDown /> : <ChevronRight />}</span>
                      <span className={`cloud-fetch-log-status ${statusClass(s.status)}`}>
                        {s.status}
                      </span>
                      <span className="cloud-library-source-name">
                        {s.sourceName ?? s.builderId}
                        {s.sourceType ? ` · ${s.sourceType}` : ""}
                      </span>
                      <span className="cloud-library-source-meta">
                        {s.effectiveFrequency} · {s.submitterCount}{" "}
                        {s.submitterCount === 1 ? "submitter" : "submitters"} · {s.postCount}{" "}
                        {s.postCount === 1 ? "post" : "posts"}
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="cloud-library-source-detail">
                        <p className="cron-field-hint">
                          Last success: {formatDate(s.lastSuccessAt)} · Last failure:{" "}
                          {formatDate(s.lastFailureAt)}
                          {s.lastFailureReason ? ` (${s.lastFailureReason})` : ""} · Next attempt:{" "}
                          {formatDate(s.nextAttemptAt)}
                          {s.circuitBreakerUntil
                            ? ` · circuit-broken until ${formatDate(s.circuitBreakerUntil)}`
                            : ""}
                        </p>
                        {loading === s.builderId ? (
                          <p className="cron-field-hint">Loading…</p>
                        ) : detail ? (
                          <>
                            <p className="cloud-library-detail-label">Submitters</p>
                            {detail.submitters.length === 0 ? (
                              <p className="cron-field-hint">No active submitters.</p>
                            ) : (
                              <ul className="cloud-library-submitters">
                                {detail.submitters.map((sub, index) => (
                                  <li key={sub.email ?? `submitter-${index}`} className="cron-field-hint">
                                    {sub.email ?? sub.name ?? "unknown"} · {sub.frequency}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <p className="cloud-library-detail-label">Recent posts</p>
                            {detail.posts.length === 0 ? (
                              <p className="cron-field-hint">No posts fetched yet.</p>
                            ) : (
                              <ul className="cloud-library-posts">
                                {detail.posts.map((post) => (
                                  <li key={post.id} className="cloud-library-post">
                                    <a
                                      href={post.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="fb-link"
                                    >
                                      {post.title ?? post.url}
                                    </a>
                                    <span className="cron-field-hint"> · {formatDate(post.publishedAt)}</span>
                                    {post.summaryExcerpt ? (
                                      <p className="cron-field-hint">{post.summaryExcerpt}</p>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
      {error ? <p className="cron-field-error">{error}</p> : null}
    </div>
  );
}
