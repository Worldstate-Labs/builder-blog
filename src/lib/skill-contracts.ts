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
const MAX_DIGEST_CONTENT = 200_000; // ~200 KB per digest
const MAX_ITEMS_PER_BUILDER = 500;
const MAX_BUILDERS_PER_SYNC = 50;

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

export const SkillBuilderSyncSchema = z.object({
  force: z.boolean().default(false),
  fetchTool: z.string().min(1).max(160).default("Agent skill sync"),
  builders: z.array(SkillBuilderSchema).min(1).max(MAX_BUILDERS_PER_SYNC),
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

export const SkillDigestSchema = z.object({
  title: z.string().min(1).max(180),
  content: z.string().min(1).max(MAX_DIGEST_CONTENT),
  language: z.string().max(16).default("zh"),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  itemCount: z.number().int().min(0).max(10_000).default(0),
  // Re-generate today's digest: when true the create route replaces this
  // user's existing same-day digest(s) instead of stacking a duplicate. Set
  // by the digest "override" toggle (forwarded as `--regenerate` by the CLI).
  regenerate: z.boolean().default(false),
  // The candidate posts presented to this digest. The create route upserts a
  // per-user DigestedItem for each so they don't participate in future digests.
  digestedItems: z.array(SkillDigestedItemSchema).max(5_000).default([]),
});

export function parseSkillBuilderSyncPayload(payload: unknown) {
  return SkillBuilderSyncSchema.safeParse(payload);
}

export function parseSkillDigestPayload(payload: unknown) {
  return SkillDigestSchema.safeParse(payload);
}
