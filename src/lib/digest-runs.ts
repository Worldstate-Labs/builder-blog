import { prisma } from "@/lib/prisma";

// One candidate post the digest run considered, tagged with whether the
// editorial step actually presented it (`included`) or passed it over
// (`included: false` = "eligible but dropped").
export type DigestRunCandidate = {
  entityId: string;
  kind: string;
  title: string | null;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
  included: boolean;
};

// Per-followed-source coverage for one run: how many of that source's posts
// were eligible this run and how many made it in. `eligible: 0` = a followed
// source that stayed silent (nothing new in the window).
export type DigestRunSource = {
  entityId: string;
  name: string;
  eligible: number;
  included: number;
};

// One digest generation attempt, newest first — the diagnostic funnel, not the
// digest content. Lets the user understand the process (what was eligible, what
// window, which sources) and diagnose mismatches (why empty / why a post was
// left out). Backed by the DigestRun table, which snapshots the candidate pool
// at `prepare` and is completed at `sync`.
export type DigestRunListItem = {
  id: string;
  status: string; // "prepared" | "synced"
  source: string;
  preparedAt: string;
  syncedAt: string | null;
  language: string | null;
  digestTitle: string | null;
  // Window the run covered.
  lookbackCutoff: string | null;
  maxPostAgeDays: number | null;
  lastDigestAt: string | null;
  regenerate: boolean;
  // Funnel counts.
  subscriptionCount: number;
  candidateCount: number;
  includedCount: number | null; // null while still "prepared"
  droppedCount: number | null;
  contributingSourceCount: number;
  // Detail.
  sources: DigestRunSource[];
  candidates: DigestRunCandidate[];
};

const DIGEST_RUN_LIMIT = 25;
const CANDIDATES_PER_RUN = 120;

type CandidateSnapshot = {
  entityId?: string;
  kind?: string;
  externalId?: string;
  feedItemId?: string | null;
  title?: string | null;
  url?: string | null;
  source?: string | null;
  publishedAt?: string | null;
};

type SubscriptionSnapshot = {
  entityId?: string;
  name?: string;
};

function contentKey(entityId: string, kind: string, externalId: string): string {
  return `${entityId}:${kind}:${externalId}`;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function getDigestRuns(
  userId: string,
  limit = DIGEST_RUN_LIMIT,
): Promise<DigestRunListItem[]> {
  const runs = await prisma.digestRun.findMany({
    where: { userId },
    orderBy: { preparedAt: "desc" },
    take: limit,
  });

  return runs.map((run) => {
    const candidates = asArray<CandidateSnapshot>(run.candidates);
    const subscriptions = asArray<SubscriptionSnapshot>(run.subscriptions);
    const includedKeys = new Set(asArray<string>(run.includedKeys));
    const synced = run.status === "synced";

    // Name lookup for source coverage, falling back to whatever the candidate
    // snapshot carried for entities that aren't in the subscription snapshot.
    const nameByEntity = new Map<string, string>();
    for (const sub of subscriptions) {
      if (sub.entityId) nameByEntity.set(sub.entityId, sub.name ?? "Unknown source");
    }

    // Per-entity eligible/included tallies from the candidate snapshot.
    const tally = new Map<string, { eligible: number; included: number }>();
    const shapedCandidates: DigestRunCandidate[] = [];
    for (const cand of candidates.slice(0, CANDIDATES_PER_RUN)) {
      const entityId = cand.entityId ?? "";
      const kind = cand.kind ?? "";
      const externalId = cand.externalId ?? "";
      const included = synced && includedKeys.has(contentKey(entityId, kind, externalId));
      const row = tally.get(entityId) ?? { eligible: 0, included: 0 };
      row.eligible += 1;
      if (included) row.included += 1;
      tally.set(entityId, row);
      if (cand.source && entityId && !nameByEntity.has(entityId)) {
        nameByEntity.set(entityId, cand.source);
      }
      shapedCandidates.push({
        entityId,
        kind,
        title: cand.title ?? null,
        url: cand.url ?? null,
        source: cand.source ?? nameByEntity.get(entityId) ?? null,
        publishedAt: cand.publishedAt ?? null,
        included,
      });
    }

    // Source coverage = every followed source, contributing first, then silent
    // followed sources, then any contributing entity not in the subscription
    // snapshot (shouldn't normally happen, but keep it visible).
    const sourceEntityIds = new Set<string>([
      ...subscriptions.map((s) => s.entityId).filter((id): id is string => Boolean(id)),
      ...tally.keys(),
    ]);
    const sources: DigestRunSource[] = [...sourceEntityIds]
      .filter(Boolean)
      .map((entityId) => {
        const t = tally.get(entityId) ?? { eligible: 0, included: 0 };
        return {
          entityId,
          name: nameByEntity.get(entityId) ?? "Unknown source",
          eligible: t.eligible,
          included: t.included,
        };
      })
      .sort((a, b) =>
        b.eligible - a.eligible || b.included - a.included || a.name.localeCompare(b.name),
      );

    // Presented posts first in the detail list, then dropped, each newest first.
    shapedCandidates.sort((a, b) => {
      if (a.included !== b.included) return a.included ? -1 : 1;
      const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return bt - at;
    });

    const includedCount = synced
      ? run.includedCount ?? shapedCandidates.filter((c) => c.included).length
      : null;
    const droppedCount = includedCount === null ? null : Math.max(0, run.candidateCount - includedCount);

    return {
      id: run.id,
      status: run.status,
      source: run.source,
      preparedAt: run.preparedAt.toISOString(),
      syncedAt: run.syncedAt?.toISOString() ?? null,
      language: run.language,
      digestTitle: run.digestTitle,
      lookbackCutoff: run.lookbackCutoff?.toISOString() ?? null,
      maxPostAgeDays: run.maxPostAgeDays,
      lastDigestAt: run.lastDigestAt?.toISOString() ?? null,
      regenerate: run.regenerate,
      subscriptionCount: run.subscriptionCount,
      candidateCount: run.candidateCount,
      includedCount,
      droppedCount,
      contributingSourceCount: sources.filter((s) => s.eligible > 0).length,
      sources,
      candidates: shapedCandidates,
    };
  });
}
