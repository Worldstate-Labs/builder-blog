-- Per-source-type, admin-editable runtime configuration.
-- Static fields (id, builderKind, feedItemKinds, urlPatterns, crawl fn)
-- still live in config/sources.json. Everything in this table is
-- hot-editable from the admin UI and is the single runtime source of
-- truth for prompts, content-quality thresholds, and crawl cadence.
-- Rows are seeded by the app on startup (see src/lib/source-config-seed.ts)
-- so this table is never empty in any environment.
CREATE TABLE IF NOT EXISTS "SourceTypeConfig" (
  "sourceId"                          TEXT NOT NULL,
  "label"                             TEXT NOT NULL,
  "agentDefaultStatus"                TEXT NOT NULL DEFAULT 'ready',
  "defaultCrawlDays"                  INTEGER NOT NULL DEFAULT 7,
  "defaultCrawlLimit"                 INTEGER NOT NULL DEFAULT 3,
  "contentQuality"                    JSONB NOT NULL,
  "summaryPromptBody"                 TEXT NOT NULL,
  "summaryPromptSinglePostAdaptation" TEXT NOT NULL,
  "summaryStyle"                      TEXT NOT NULL,
  "summaryLanguage"                   TEXT NOT NULL DEFAULT 'zh',
  "summaryLengthHint"                 TEXT,
  "updatedAt"                         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy"                         TEXT,
  CONSTRAINT "SourceTypeConfig_pkey" PRIMARY KEY ("sourceId")
);

-- Singleton (id="global") that holds digest-level prompts and the
-- section order used by both digest-once and the assembly skill.
CREATE TABLE IF NOT EXISTS "DigestConfig" (
  "id"              TEXT NOT NULL DEFAULT 'global',
  "digestTopPrompt" TEXT NOT NULL,
  "digestIntro"     TEXT NOT NULL,
  "translate"       TEXT NOT NULL,
  "digestOrder"     JSONB NOT NULL,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy"       TEXT,
  CONSTRAINT "DigestConfig_pkey" PRIMARY KEY ("id")
);
