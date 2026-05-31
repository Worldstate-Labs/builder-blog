import type { PrismaClient } from "@prisma/client";
import sourcesConfig from "../../config/sources.json";
import { DEFAULT_DIGEST_PROMPTS } from "./digest-prompts";

// Database-row shapes for the two admin-editable config tables. Kept
// here (not exported from a Prisma model) so seed and store agree on
// the exact serialized JSON columns even before Prisma generate runs.

// primaryContentOnly + disallowedPrimarySources are intentionally NOT here:
// "use real primary content only" is a fixed rule, enforced by the skill prompts
// and the CLI's hardcoded per-source defaults (builder-digest.mjs), not an
// admin-editable knob.
export type ContentQualityShape = {
  minChars: number;
  minWords: number;
  minUniqueWordRatio?: number;
  maxTimestampWordRatio?: number;
};

export type SourceSummaryStyle = "x_twitter" | "podcast_or_video" | "blog_or_document";
export type AgentDefaultStatus = "ready" | "requires_agent";

export type SourceTypeConfigShape = {
  sourceId: string;
  label: string;
  agentDefaultStatus: AgentDefaultStatus;
  defaultFetchDays: number;
  defaultFetchLimit: number;
  contentQuality: ContentQualityShape;
  summaryPromptBody: string;
  /// Optional per-source fetch prompt. Surfaced to the agent in
  /// fallback fetch tasks so it can decide HOW to acquire content
  /// (e.g. for podcast: try show notes first, else download audio +
  /// Whisper transcribe). Null means "no agent instructions; CLI
  /// deterministic behavior is authoritative".
  fetchPromptBody: string | null;
  summaryStyle: SourceSummaryStyle;
  summaryLanguage: string;
  summaryLengthHint: string | null;
};

export type DigestConfigShape = {
  id: string;
  digestIntro: string;
  translate: string;
  digestOrder: string[];
  commonSummaryRules: string;
};

// Verbatim default text seeded into `DigestConfig.commonSummaryRules`.
// Mirrored in `prisma/migrations/000024_common_summary_rules` so existing
// rows backfill with the identical block.
export const DEFAULT_COMMON_SUMMARY_RULES = `This task is self-contained; do not read external prompt files.

- Summarize exactly one supplied task item.
- Use task.item.body as the primary content.
- Use task.item.title, source metadata, and task.item.url only as context and source attribution.
- Include the direct source URL for every claim.
- Do not summarize from title, description, or page metadata alone.
- Apply the quality bar and no-fabrication, direct-quote-only, source-link rules stated in the source-specific prompt below.`;

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

function fetchPromptBodyForSourceId(sourceId: string): string | null {
  if (sourceId === "podcast") return DEFAULT_DIGEST_PROMPTS.fetchPodcastAudio;
  return null;
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
        defaultFetchDays: 7,
        defaultFetchLimit: 3,
        contentQuality: entry.contentQuality as ContentQualityShape,
        summaryPromptBody: summaryPromptBodyForSourceId(entry.id),
        fetchPromptBody: fetchPromptBodyForSourceId(entry.id),
        summaryStyle: summaryStyleForSourceId(entry.id),
        summaryLanguage: "zh",
        summaryLengthHint: null,
      };
      return [entry.id, config];
    }),
  );

export const DEFAULT_DIGEST_CONFIG: DigestConfigShape = {
  id: "global",
  digestIntro: DEFAULT_DIGEST_PROMPTS.digestIntro,
  translate: DEFAULT_DIGEST_PROMPTS.translate,
  digestOrder: ["x", "blog", "youtube", "podcast", "pdf", "website"],
  commonSummaryRules: DEFAULT_COMMON_SUMMARY_RULES,
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
      defaultFetchDays: config.defaultFetchDays,
      defaultFetchLimit: config.defaultFetchLimit,
      contentQuality: config.contentQuality as object,
      summaryPromptBody: config.summaryPromptBody,
      fetchPromptBody: config.fetchPromptBody,
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
        digestIntro: DEFAULT_DIGEST_CONFIG.digestIntro,
        translate: DEFAULT_DIGEST_CONFIG.translate,
        digestOrder: DEFAULT_DIGEST_CONFIG.digestOrder as object,
        commonSummaryRules: DEFAULT_DIGEST_CONFIG.commonSummaryRules,
      },
    ],
    skipDuplicates: true,
  });
}
