import type { PrismaClient } from "@prisma/client";
import sourcesConfig from "../../config/sources.json";
import { DEFAULT_DIGEST_PROMPTS } from "./digest-prompts";

// Database-row shapes for the two admin-editable config tables. Kept
// here (not exported from a Prisma model) so seed and store agree on
// the exact serialized JSON columns even before Prisma generate runs.

export type ContentQualityShape = {
  primaryContentOnly: boolean;
  minChars: number;
  minWords: number;
  minUniqueWordRatio?: number;
  maxTimestampWordRatio?: number;
  disallowedPrimarySources: string[];
};

export type SourceSummaryStyle = "x_twitter" | "podcast_or_video" | "blog_or_document";
export type AgentDefaultStatus = "ready" | "requires_agent";

export type SourceTypeConfigShape = {
  sourceId: string;
  label: string;
  agentDefaultStatus: AgentDefaultStatus;
  defaultCrawlDays: number;
  defaultCrawlLimit: number;
  contentQuality: ContentQualityShape;
  summaryPromptBody: string;
  summaryPromptSinglePostAdaptation: string;
  summaryStyle: SourceSummaryStyle;
  summaryLanguage: string;
  summaryLengthHint: string | null;
};

export type DigestConfigShape = {
  id: string;
  digestTopPrompt: string;
  digestIntro: string;
  translate: string;
  digestOrder: string[];
};

// `singlePostAdaptation` strings preserved verbatim from the old
// `summaryPromptReferenceForKind` fallbacks in scripts/builder-digest.mjs
// so the once-skill flows render identical instructions to before.
const SINGLE_POST_ADAPTATION_X =
  "- Apply the X/Twitter rules to this one tweet or one thread from this builder/source.";
const SINGLE_POST_ADAPTATION_PODCAST =
  "- Apply the podcast/video rules to this one episode or one video transcript.";
const SINGLE_POST_ADAPTATION_BLOG =
  "- Apply the blog/article rules to this one article or document.";

function summaryStyleForSourceId(sourceId: string): SourceSummaryStyle {
  if (sourceId === "x") return "x_twitter";
  if (sourceId === "youtube" || sourceId === "podcast") return "podcast_or_video";
  return "blog_or_document";
}

function summaryPromptBodyForSourceId(sourceId: string): string {
  const style = summaryStyleForSourceId(sourceId);
  if (style === "x_twitter") return DEFAULT_DIGEST_PROMPTS.summarizeTweets;
  if (style === "podcast_or_video") return DEFAULT_DIGEST_PROMPTS.summarizePodcast;
  return DEFAULT_DIGEST_PROMPTS.summarizeBlogs;
}

function singlePostAdaptationForSourceId(sourceId: string): string {
  const style = summaryStyleForSourceId(sourceId);
  if (style === "x_twitter") return SINGLE_POST_ADAPTATION_X;
  if (style === "podcast_or_video") return SINGLE_POST_ADAPTATION_PODCAST;
  return SINGLE_POST_ADAPTATION_BLOG;
}

export const DEFAULT_SOURCE_CONFIGS: Record<string, SourceTypeConfigShape> =
  Object.fromEntries(
    sourcesConfig.sources.map((entry) => {
      const config: SourceTypeConfigShape = {
        sourceId: entry.id,
        label: entry.label,
        agentDefaultStatus: (entry.agentDefaultStatus === "requires_agent"
          ? "requires_agent"
          : "ready") as AgentDefaultStatus,
        defaultCrawlDays: 7,
        defaultCrawlLimit: 3,
        contentQuality: entry.contentQuality as ContentQualityShape,
        summaryPromptBody: summaryPromptBodyForSourceId(entry.id),
        summaryPromptSinglePostAdaptation: singlePostAdaptationForSourceId(entry.id),
        summaryStyle: summaryStyleForSourceId(entry.id),
        summaryLanguage: "zh",
        summaryLengthHint: null,
      };
      return [entry.id, config];
    }),
  );

export const DEFAULT_DIGEST_CONFIG: DigestConfigShape = {
  id: "global",
  digestTopPrompt: DEFAULT_DIGEST_PROMPTS.digest,
  digestIntro: DEFAULT_DIGEST_PROMPTS.digestIntro,
  translate: DEFAULT_DIGEST_PROMPTS.translate,
  digestOrder: ["x", "blog", "youtube", "podcast", "pdf", "website"],
};

export const SEEDED_SOURCE_IDS = Object.keys(DEFAULT_SOURCE_CONFIGS);

// Idempotent: only inserts rows that are missing. Admin edits to
// existing rows are preserved across deploys. Safe to call on every
// boot.
export async function ensureSourceConfigsSeeded(client: PrismaClient): Promise<void> {
  // Seed source-type rows first, then the singleton digest config.
  await client.sourceTypeConfig.createMany({
    data: Object.values(DEFAULT_SOURCE_CONFIGS).map((config) => ({
      sourceId: config.sourceId,
      label: config.label,
      agentDefaultStatus: config.agentDefaultStatus,
      defaultCrawlDays: config.defaultCrawlDays,
      defaultCrawlLimit: config.defaultCrawlLimit,
      contentQuality: config.contentQuality as object,
      summaryPromptBody: config.summaryPromptBody,
      summaryPromptSinglePostAdaptation: config.summaryPromptSinglePostAdaptation,
      summaryStyle: config.summaryStyle,
      summaryLanguage: config.summaryLanguage,
      summaryLengthHint: config.summaryLengthHint,
    })),
    skipDuplicates: true,
  });

  // The singleton row uses a fixed primary key ("global"); createMany +
  // skipDuplicates is the simplest no-op-when-present write.
  await client.digestConfig.createMany({
    data: [
      {
        id: DEFAULT_DIGEST_CONFIG.id,
        digestTopPrompt: DEFAULT_DIGEST_CONFIG.digestTopPrompt,
        digestIntro: DEFAULT_DIGEST_CONFIG.digestIntro,
        translate: DEFAULT_DIGEST_CONFIG.translate,
        digestOrder: DEFAULT_DIGEST_CONFIG.digestOrder as object,
      },
    ],
    skipDuplicates: true,
  });
}
