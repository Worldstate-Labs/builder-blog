export type DurableRawMode = "none" | "excerpt" | "full" | "facts_only";

export type RawContentPolicy = {
  sourceType: string;
  processingRaw: "allowed" | "blocked";
  durableRawMode: DurableRawMode;
  durableRawMaxChars: number;
  hubRawSharing: false;
  requiresRightsBasis?: boolean;
  notes: string;
};

type RawContentInput = {
  sourceType?: string | null;
  body: string;
  summary?: string | null;
  rawJson?: unknown;
};

type PreparedFeedItemStorage = {
  body: string;
  rawJson: unknown;
  policy: RawContentPolicy;
  rawContentKind: string;
  acquisition: Record<string, unknown>;
  rawRetained: boolean;
  rawTruncated: boolean;
  bodyStored: boolean;
};

const RAW_STRING_LIMIT = 1000;
const RAW_ARRAY_LIMIT = 20;
const RAW_OBJECT_DEPTH_LIMIT = 5;

const BASE_POLICIES: Record<string, RawContentPolicy> = {
  x: {
    sourceType: "x",
    processingRaw: "allowed",
    durableRawMode: "full",
    durableRawMaxChars: 4000,
    hubRawSharing: false,
    notes: "Store tweet text only; do not retain full API objects.",
  },
  blog: {
    sourceType: "blog",
    processingRaw: "allowed",
    durableRawMode: "full",
    durableRawMaxChars: 50_000,
    hubRawSharing: false,
    notes: "Public article text may be retained subject to site rights and robots checks.",
  },
  website: {
    sourceType: "website",
    processingRaw: "allowed",
    durableRawMode: "excerpt",
    durableRawMaxChars: 12_000,
    hubRawSharing: false,
    notes: "Retain a bounded page excerpt; use full page text only during local processing.",
  },
  github_trending: {
    sourceType: "github_trending",
    processingRaw: "allowed",
    durableRawMode: "facts_only",
    durableRawMaxChars: 8000,
    hubRawSharing: false,
    notes: "Retain repo facts and investigation notes, not raw README or code dumps.",
  },
  product_hunt_top_products: {
    sourceType: "product_hunt_top_products",
    processingRaw: "allowed",
    durableRawMode: "facts_only",
    durableRawMaxChars: 8000,
    hubRawSharing: false,
    notes: "Retain structured product facts and summary, not raw Product Hunt HTML/comments.",
  },
  youtube: {
    sourceType: "youtube",
    processingRaw: "allowed",
    durableRawMode: "none",
    durableRawMaxChars: 0,
    hubRawSharing: false,
    requiresRightsBasis: true,
    notes: "Use transcripts only for local processing unless explicit durable rights exist.",
  },
  podcast: {
    sourceType: "podcast",
    processingRaw: "allowed",
    durableRawMode: "excerpt",
    durableRawMaxChars: 30_000,
    hubRawSharing: false,
    notes: "RSS show notes may be retained as an excerpt; audio transcripts are temporary by default.",
  },
};

const DANGEROUS_RAW_JSON_KEYS = new Set([
  "audio",
  "audioFile",
  "body",
  "captionText",
  "comments",
  "content",
  "html",
  "pageHtml",
  "raw",
  "rawBody",
  "rawContent",
  "rawHtml",
  "rawJson",
  "rawText",
  "rawTranscript",
  "text",
  "transcript",
  "transcriptText",
  "tweet",
]);

export function sourceContentPolicyFor(
  sourceType: string | null | undefined,
  rawContentKind?: string | null,
): RawContentPolicy {
  const normalized = normalizeSourceType(sourceType);
  const base = BASE_POLICIES[normalized] ?? {
    sourceType: normalized || "unknown",
    processingRaw: "allowed",
    durableRawMode: "excerpt",
    durableRawMaxChars: 12_000,
    hubRawSharing: false,
    notes: "Unknown source types retain only bounded excerpts.",
  };

  if (base.sourceType === "podcast" && rawContentKind === "transcript") {
    return {
      ...base,
      durableRawMode: "none",
      durableRawMaxChars: 0,
      requiresRightsBasis: true,
      notes: "Podcast audio transcripts are temporary by default; retain only the summary.",
    };
  }

  if (base.sourceType === "youtube" && hasExplicitDurableRights(rawContentKind)) {
    return {
      ...base,
      durableRawMode: "full",
      durableRawMaxChars: 50_000,
      notes: "YouTube transcript retention allowed only for explicitly rights-cleared content.",
    };
  }

  return base;
}

export function prepareFeedItemStorage(input: RawContentInput): PreparedFeedItemStorage {
  const sourceType = normalizeSourceType(input.sourceType);
  const rawJsonObject = objectRecord(input.rawJson);
  const rawContentKind = inferRawContentKind(sourceType, rawJsonObject);
  const policy = sourceContentPolicyFor(sourceType, rawContentKind);
  const acquisition = normalizeAcquisition(sourceType, rawContentKind, rawJsonObject);
  const preparedBody = durableBodyForPolicy({
    body: input.body,
    policy,
  });
  const bodyStored = normalizeContent(preparedBody).length > 0;
  const rawRetained = bodyStored && bodyCanBeStoredForPolicy(policy);
  const rawTruncated =
    rawRetained &&
    policy.durableRawMaxChars > 0 &&
    normalizeContent(input.body).length > normalizeContent(preparedBody).length;

  return {
    body: preparedBody,
    rawJson: sanitizeRawJson({
      rawJson: rawJsonObject,
      acquisition,
      policy,
      rawContentKind,
      rawRetained,
      rawTruncated,
      bodyStored,
    }),
    policy,
    rawContentKind,
    acquisition,
    rawRetained,
    rawTruncated,
    bodyStored,
  };
}

export function bodyCanBeStoredForPolicy(policy: RawContentPolicy): boolean {
  return (
    policy.durableRawMode === "full" ||
    policy.durableRawMode === "excerpt" ||
    policy.durableRawMode === "facts_only"
  );
}

export function inferRawContentKind(
  sourceType: string | null | undefined,
  rawJson: Record<string, unknown> | null | undefined,
): string {
  const source = normalizeSourceType(sourceType);
  const transcriptSource = stringValue(rawJson?.transcriptSource || rawJson?.contentSource);
  if (source === "youtube") return "transcript";
  if (source === "podcast") {
    if (
      transcriptSource ||
      /transcript|asr|speech|whisper/i.test(stringValue(rawJson?.source)) ||
      /transcription/i.test(stringValue(rawJson?.agentWorkType))
    ) {
      return "transcript";
    }
    return "show_notes";
  }
  if (source === "x") return "tweet_text";
  if (source === "blog") return "article";
  if (source === "website") return "page";
  if (source === "github_trending") return "repo_facts";
  if (source === "product_hunt_top_products") return "product_facts";
  return "raw_content";
}

function durableBodyForPolicy({
  body,
  policy,
}: {
  body: string;
  policy: RawContentPolicy;
}) {
  const normalizedBody = normalizeContent(body);

  if (policy.durableRawMode === "none") {
    return "";
  }

  if (policy.durableRawMode === "facts_only") {
    return excerpt(normalizedBody, policy.durableRawMaxChars);
  }

  if (policy.durableRawMode === "excerpt") {
    return excerpt(normalizedBody, policy.durableRawMaxChars);
  }

  return excerpt(normalizedBody, policy.durableRawMaxChars);
}

function sanitizeRawJson({
  rawJson,
  acquisition,
  policy,
  rawContentKind,
  rawRetained,
  rawTruncated,
  bodyStored,
}: {
  rawJson: Record<string, unknown>;
  acquisition: Record<string, unknown>;
  policy: RawContentPolicy;
  rawContentKind: string;
  rawRetained: boolean;
  rawTruncated: boolean;
  bodyStored: boolean;
}) {
  return {
    ...sanitizeUnknownRecord(rawJson, 0),
    acquisition,
    rawContentPolicy: {
      sourceType: policy.sourceType,
      rawContentKind,
      processingRaw: policy.processingRaw,
      durableRawMode: policy.durableRawMode,
      durableRawMaxChars: policy.durableRawMaxChars,
      bodyStored,
      rawRetained,
      rawTruncated,
      hubRawSharing: false,
      temporaryRawCleanup: "required",
    },
  };
}

function sanitizeUnknownRecord(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (DANGEROUS_RAW_JSON_KEYS.has(key)) {
      output[key] = "[removed raw content]";
      continue;
    }
    output[key] = sanitizeUnknownValue(rawValue, depth + 1);
  }
  return output;
}

function sanitizeUnknownValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length > RAW_STRING_LIMIT
      ? `[removed long string:${value.length} chars]`
      : value;
  }
  if (Array.isArray(value)) {
    if (depth >= RAW_OBJECT_DEPTH_LIMIT) return `[removed deep array:${value.length} items]`;
    return value.slice(0, RAW_ARRAY_LIMIT).map((item) => sanitizeUnknownValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= RAW_OBJECT_DEPTH_LIMIT) return "[removed deep object]";
    return sanitizeUnknownRecord(value as Record<string, unknown>, depth);
  }
  return undefined;
}

function normalizeAcquisition(
  sourceType: string,
  rawContentKind: string,
  rawJson: Record<string, unknown>,
) {
  const existing = objectRecord(rawJson.acquisition);
  return {
    provider: stringValue(existing.provider) || providerForSourceType(sourceType),
    method:
      stringValue(existing.method) ||
      stringValue(rawJson.transcriptSource) ||
      stringValue(rawJson.contentSource) ||
      methodForSourceType(sourceType, rawContentKind, rawJson),
    processedLocally: existing.processedLocally ?? true,
    rawPersistedRequested: existing.rawPersistedRequested ?? true,
    rightsBasis:
      stringValue(existing.rightsBasis) ||
      stringValue(rawJson.rightsBasis) ||
      defaultRightsBasis(sourceType, rawContentKind),
  };
}

function methodForSourceType(
  sourceType: string,
  rawContentKind: string,
  rawJson: Record<string, unknown>,
) {
  if (sourceType === "x") return "x-api-v2";
  if (sourceType === "youtube") return stringValue(rawJson.transcriptSource) || "youtube-local-transcript";
  if (sourceType === "podcast") {
    return rawContentKind === "transcript" ? "podcast-local-transcription" : "podcast-rss-show-notes";
  }
  if (sourceType === "blog") return "rss-or-html-article";
  if (sourceType === "website") return "website-html-extract";
  if (sourceType === "github_trending") return "github-trending-investigation";
  if (sourceType === "product_hunt_top_products") return "product-hunt-structured-facts";
  return "local-agent-fetch";
}

function providerForSourceType(sourceType: string) {
  if (sourceType === "x") return "x";
  if (sourceType === "youtube") return "youtube";
  if (sourceType === "product_hunt_top_products") return "product-hunt";
  if (sourceType === "github_trending") return "github";
  if (sourceType === "podcast") return "podcast-rss";
  if (sourceType === "blog") return "blog";
  if (sourceType === "website") return "website";
  return sourceType || "unknown";
}

function defaultRightsBasis(sourceType: string, rawContentKind: string) {
  if (sourceType === "x") return "platform-api-user-token";
  if (sourceType === "youtube") return "user-directed-local-processing";
  if (sourceType === "podcast" && rawContentKind === "transcript") {
    return "user-directed-local-processing";
  }
  if (sourceType === "product_hunt_top_products") return "structured-facts-only";
  return "public-source-user-directed";
}

function hasExplicitDurableRights(rawContentKind?: string | null) {
  return rawContentKind === "rights_cleared_transcript";
}

function normalizeSourceType(sourceType: string | null | undefined) {
  return String(sourceType || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeContent(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function excerpt(value: string, maxChars: number) {
  if (!value) return "";
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 18)).trimEnd()} [truncated]`;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
