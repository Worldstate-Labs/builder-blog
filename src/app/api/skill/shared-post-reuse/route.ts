import { NextResponse } from "next/server";
import { z } from "zod";
import { canonicalPostUrl, postUrlLookupVariants } from "@/lib/canonical-url";
import { checkBodyContentQuality } from "@/lib/content-quality";
import { normalizeSummaryLanguagePreference } from "@/lib/language-preference";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { getAllSourceConfigs } from "@/lib/source-config-store";
import { getUserFromBearer } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";

const MAX_CANDIDATES = 500;
const MAX_URL = 2_048;

const CandidateSchema = z.object({
  id: z.string().min(1).max(500),
  url: z.string().url().max(MAX_URL),
  kind: z.string().max(80).nullable().optional(),
  sourceType: z.string().max(80).nullable().optional(),
});

const ReuseRequestSchema = z.object({
  summaryLanguage: z.string().max(40).nullable().optional(),
  candidates: z.array(CandidateSchema).max(MAX_CANDIDATES),
});

type Candidate = z.infer<typeof CandidateSchema>;

function rawJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function rawString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function summaryLanguageMatches(value: unknown, targetLanguage: string) {
  const stored = rawString(value);
  if (!stored) return false;
  return normalizeSummaryLanguagePreference(stored).toLowerCase() === targetLanguage.toLowerCase();
}

function sourceTypeKey(value: unknown) {
  return rawString(value).toLowerCase();
}

function candidateBodyIsUsable(body: string, sourceType: string | null | undefined, standardsBySourceId: Map<string, unknown>) {
  const standards =
    standardsBySourceId.get(sourceTypeKey(sourceType)) ??
    standardsBySourceId.get("website") ??
    null;
  return checkBodyContentQuality(body, standards).ok;
}

function matchScore(match: { summary: string | null; body: string; createdAt: Date }) {
  return [
    match.summary ? 1 : 0,
    match.body.length,
    match.createdAt.getTime(),
  ] as const;
}

function compareMatches(
  left: { summary: string | null; body: string; createdAt: Date; feedItemId: string },
  right: { summary: string | null; body: string; createdAt: Date; feedItemId: string },
) {
  const a = matchScore(left);
  const b = matchScore(right);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return left.feedItemId.localeCompare(right.feedItemId);
}

export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = rateLimit({
    key: `skill-shared-post-reuse:${user.id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.ok) return tooManyRequestsResponse(limit.retryAfterMs);

  const parsed = ReuseRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const targetLanguage = normalizeSummaryLanguagePreference(parsed.data.summaryLanguage);
  const candidates = parsed.data.candidates;
  if (candidates.length === 0) return NextResponse.json({ status: "ok", matches: [] });

  const candidateByCanonical = new Map<string, Candidate[]>();
  const urlVariants = new Set<string>();
  for (const candidate of candidates) {
    const canonical = canonicalPostUrl(candidate.url);
    if (!canonical) continue;
    const bucket = candidateByCanonical.get(canonical) ?? [];
    bucket.push(candidate);
    candidateByCanonical.set(canonical, bucket);
    for (const variant of postUrlLookupVariants(candidate.url)) urlVariants.add(variant);
  }
  if (candidateByCanonical.size === 0 || urlVariants.size === 0) {
    return NextResponse.json({ status: "ok", matches: [] });
  }

  const sourceConfigs = await getAllSourceConfigs();
  const standardsBySourceId = new Map(sourceConfigs.map((config) => [config.sourceId.toLowerCase(), config.contentQuality]));
  const canonicalUrls = [...candidateByCanonical.keys()];
  const rows = await prisma.feedItem.findMany({
    where: {
      OR: [
        { canonicalPost: { is: { canonicalUrl: { in: canonicalUrls } } } },
        { url: { in: [...urlVariants] } },
      ],
      body: { not: "" },
      builder: { is: { hubItems: { some: {} } } },
    },
    select: {
      id: true,
      builderId: true,
      kind: true,
      externalId: true,
      title: true,
      url: true,
      body: true,
      summary: true,
      publishedAt: true,
      sourceName: true,
      fetchTool: true,
      rawJson: true,
      createdAt: true,
      builder: {
        select: {
          id: true,
          name: true,
          sourceType: true,
        },
      },
      canonicalPost: {
        select: {
          canonicalUrl: true,
        },
      },
    },
  });

  const bestByCandidateId = new Map<string, {
    candidate: Candidate;
    feedItemId: string;
    builderId: string | null;
    builderName: string | null;
    url: string;
    body: string;
    summary: string | null;
    summaryLanguage: string | null;
    createdAt: Date;
  }>();

  for (const row of rows) {
    const canonical = row.canonicalPost?.canonicalUrl ?? canonicalPostUrl(row.url);
    if (!canonical) continue;
    const matchingCandidates = candidateByCanonical.get(canonical) ?? [];
    if (matchingCandidates.length === 0) continue;
    const rawJson = rawJsonRecord(row.rawJson);
    const rowSummary = rawString(row.summary);
    const rowSummaryLanguage = rawString(rawJson.summaryLanguage);
    const summary = rowSummary && summaryLanguageMatches(rowSummaryLanguage, targetLanguage)
      ? rowSummary
      : null;

    for (const candidate of matchingCandidates) {
      if (!candidateBodyIsUsable(row.body, candidate.sourceType, standardsBySourceId)) continue;
      const match = {
        candidate,
        feedItemId: row.id,
        builderId: row.builderId,
        builderName: row.builder?.name ?? null,
        url: row.url,
        body: row.body,
        summary,
        summaryLanguage: summary ? rowSummaryLanguage : null,
        createdAt: row.createdAt,
      };
      const existing = bestByCandidateId.get(candidate.id);
      if (!existing || compareMatches(match, existing) < 0) {
        bestByCandidateId.set(candidate.id, match);
      }
    }
  }

  const matches = [...bestByCandidateId.values()].map((match) => ({
    id: match.candidate.id,
    body: match.body,
    summary: match.summary,
    source: {
      feedItemId: match.feedItemId,
      builderId: match.builderId,
      builderName: match.builderName,
      url: match.url,
    },
    summaryLanguage: match.summaryLanguage,
  }));

  return NextResponse.json({ status: "ok", matches });
}
