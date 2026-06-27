import { BuilderKind, FeedItemKind } from "@prisma/client";
import { z } from "zod";

// Size limits guard the skill ingest endpoints against accidental or
// malicious payloads that could exhaust DB storage or serverless memory.
const MAX_TITLE = 500;
const MAX_BODY = 100_000; // ~100 KB per post
const MAX_SUMMARY = 4_000;
const MAX_BIO = 4_000;
const MAX_URL = 2_048;
const MAX_NAME = 240;
const MAX_HANDLE = 240;
const MAX_SOURCE_NAME = 240;
const MAX_EXTERNAL_ID = 512;
const MAX_DIGEST_SUMMARY = 20_000;
const MAX_DIGEST_HEADLINE_SUMMARY = 1200;
const MAX_ITEMS_PER_BUILDER = 500;
const MAX_BUILDERS_PER_SYNC = 50;
const MAX_DIGEST_ITEMS = 5_000;
export const MAX_FETCH_TASK_ID = 500;
const MAX_TASK_OUTCOMES = 500;

export const SkillFeedItemSchema = z.object({
  kind: z.enum(FeedItemKind),
  externalId: z.string().min(1).max(MAX_EXTERNAL_ID),
  title: z.string().max(MAX_TITLE).nullable().optional(),
  body: z.string().min(1).max(MAX_BODY),
  summary: z.string().min(1).max(MAX_SUMMARY).nullable().optional(),
  url: z.string().url().max(MAX_URL),
  publishedAt: z.string().datetime().nullable().optional(),
  sourceName: z.string().max(MAX_SOURCE_NAME).nullable().optional(),
  fetchTool: z.string().min(1).max(160).nullable().optional(),
  rawJson: z.unknown().optional(),
});

export const SkillBuilderSchema = z.object({
  builderId: z.string().min(1).max(64).nullable().optional(),
  kind: z.enum(BuilderKind),
  sourceType: z.string().min(1).max(80).nullable().optional(),
  name: z.string().min(1).max(MAX_NAME),
  handle: z.string().max(MAX_HANDLE).nullable().optional(),
  sourceUrl: z.string().url().max(MAX_URL).nullable().optional(),
  fetchUrl: z.string().url().max(MAX_URL).nullable().optional(),
  bio: z.string().max(MAX_BIO).nullable().optional(),
  subscribe: z.boolean().default(false),
  items: z.array(SkillFeedItemSchema).max(MAX_ITEMS_PER_BUILDER).default([]),
});

// A non-synced terminal outcome for a planned fetchTask. Every task that does
// NOT end as a synced item must be reported here so it stays accountable (no
// silent drops, no blanket bulk-skip). `evidence` is per-task proof for a skip
// (e.g. { meanVolumeDb: -91, hasCaptions: false }); the validator requires it
// for status="skipped" so an agent can't skip many tasks on one assumption.
export const SkillTaskOutcomeSchema = z.object({
  fetchTaskId: z.string().min(1).max(MAX_FETCH_TASK_ID),
  status: z.enum(["skipped", "failed", "blocked"]),
  reason: z.string().min(1).max(400),
  evidence: z.record(z.string(), z.unknown()).optional(),
  builderId: z.string().min(1).max(64).nullable().optional(),
  externalId: z.string().max(MAX_EXTERNAL_ID).nullable().optional(),
});

export const SkillFetchRunPlannedTaskSchema = z.object({
  id: z.string().min(1).max(MAX_FETCH_TASK_ID),
}).passthrough();

export const SkillBuilderSyncSchema = z.object({
  force: z.boolean().default(false),
  fetchTool: z.string().min(1).max(160).default("Agent skill sync"),
  summaryLanguage: z.string().max(40).nullable().optional(),
  builders: z.array(SkillBuilderSchema).min(1).max(MAX_BUILDERS_PER_SYNC),
  // Per-task outcomes for tasks not synced as items (skipped / failed / blocked).
  taskOutcomes: z.array(SkillTaskOutcomeSchema).max(MAX_TASK_OUTCOMES).default([]),
  fetchRun: z.object({
    id: z.string().min(1).max(64),
    plannedTasks: z.array(SkillFetchRunPlannedTaskSchema).max(MAX_TASK_OUTCOMES).default([]),
  }).nullable().optional(),
});

// Canonical content identity of a post presented to a digest (matches the
// DigestedItem / FeedRead key). Sent by the CLI so the create route can mark
// exactly the candidate set as digested for this user.
export const SkillDigestedItemSchema = z.object({
  entityId: z.string().min(1).max(64),
  kind: z.enum(FeedItemKind),
  externalId: z.string().min(1).max(MAX_EXTERNAL_ID),
  feedItemId: z.string().min(1).max(64).nullable().optional(),
});

export const SkillDigestItemSchema = z.object({
  order: z.number().int().min(0).max(MAX_DIGEST_ITEMS),
  section: z.object({
    key: z.string().min(1).max(120),
    label: z.string().min(1).max(160),
    sourceType: z.string().min(1).max(80),
  }),
  source: z.object({
    entityId: z.string().min(1).max(64),
    name: z.string().min(1).max(MAX_SOURCE_NAME),
    sourceType: z.string().min(1).max(80),
    sourceUrl: z.string().url().max(MAX_URL).nullable().optional(),
    fetchUrl: z.string().url().max(MAX_URL).nullable().optional(),
    avatarUrl: z.string().url().max(MAX_URL).nullable().optional(),
    avatarDataUrl: z.string().max(100_000).nullable().optional(),
  }),
  sourceSummary: z.string().max(MAX_DIGEST_SUMMARY).nullable().optional(),
  post: z.object({
    feedItemId: z.string().min(1).max(64),
    entityId: z.string().min(1).max(64),
    kind: z.enum(FeedItemKind),
    externalId: z.string().min(1).max(MAX_EXTERNAL_ID),
    title: z.string().max(MAX_TITLE).nullable().optional(),
    url: z.string().url().max(MAX_URL),
    sourceName: z.string().max(MAX_SOURCE_NAME).nullable().optional(),
    sourceType: z.string().max(80).nullable().optional(),
    publishedAt: z.string().datetime().nullable().optional(),
    createdAt: z.string().datetime(),
  }),
  summary: z.string().min(1).max(MAX_DIGEST_SUMMARY),
});

export const SkillDigestSchema = z.object({
  title: z.string().min(1).max(180),
  items: z.array(SkillDigestItemSchema).min(1).max(MAX_DIGEST_ITEMS),
  headlineSummary: z.string().trim().min(1).max(MAX_DIGEST_HEADLINE_SUMMARY).nullable().optional(),
  language: z.string().max(16).default("zh"),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  itemCount: z.number().int().min(0).max(10_000).default(0),
  // Re-generate today's digest: when true the create route replaces this
  // user's existing same-day digest(s) instead of stacking a duplicate. Set
  // by the digest "override" toggle (forwarded as `--regenerate` by the CLI).
  regenerate: z.boolean().default(false),
  // Optional explicit marks remain available for internal callers, but normal
  // digest sync derives these from structured items so rendering and provenance
  // are driven by one payload.
  digestedItems: z.array(SkillDigestedItemSchema).max(MAX_DIGEST_ITEMS).default([]),
  // Links this digest to the DigestRun recorded at `prepare`, so the diagnostic
  // funnel (candidate pool, window, source coverage) is completed with the
  // actual outcome. The CLI reads it from the same context file it already
  // parses for `digestedItems`. Optional: older CLIs / missing context omit it.
  runId: z.string().min(1).max(64).nullable().optional(),
  // Local runner instance id. Different from runId: this belongs to the
  // runtime/schedule lifecycle, while runId belongs to the digest candidate
  // funnel recorded at prepare.
  jobRunId: z.string().min(1).max(160).nullable().optional(),
});

export function parseSkillBuilderSyncPayload(payload: unknown) {
  return SkillBuilderSyncSchema.safeParse(payload);
}

export function parseSkillDigestPayload(payload: unknown) {
  return SkillDigestSchema.safeParse(payload);
}
