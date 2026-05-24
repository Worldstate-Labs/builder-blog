import { BuilderKind, FeedItemKind } from "@prisma/client";
import { z } from "zod";

export const SkillFeedItemSchema = z.object({
  kind: z.enum(FeedItemKind),
  externalId: z.string().min(1),
  title: z.string().nullable().optional(),
  body: z.string().min(1),
  url: z.string().url(),
  publishedAt: z.string().datetime().nullable().optional(),
  sourceName: z.string().nullable().optional(),
  crawlingTool: z.string().min(1).max(160).nullable().optional(),
  rawJson: z.unknown().optional(),
});

export const SkillBuilderSchema = z.object({
  builderId: z.string().min(1).nullable().optional(),
  kind: z.enum(BuilderKind),
  sourceType: z.string().min(1).max(80).nullable().optional(),
  name: z.string().min(1),
  handle: z.string().nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  crawlUrl: z.string().url().nullable().optional(),
  bio: z.string().nullable().optional(),
  subscribe: z.boolean().default(false),
  items: z.array(SkillFeedItemSchema).default([]),
});

export const SkillBuilderSyncSchema = z.object({
  force: z.boolean().default(false),
  crawlingTool: z.string().min(1).max(160).default("Agent skill sync"),
  builders: z.array(SkillBuilderSchema).min(1),
});

export const SkillDigestSchema = z.object({
  title: z.string().min(1).max(180),
  content: z.string().min(1),
  language: z.string().default("zh"),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  itemCount: z.number().int().min(0).default(0),
});

export function parseSkillBuilderSyncPayload(payload: unknown) {
  return SkillBuilderSyncSchema.safeParse(payload);
}

export function parseSkillDigestPayload(payload: unknown) {
  return SkillDigestSchema.safeParse(payload);
}
