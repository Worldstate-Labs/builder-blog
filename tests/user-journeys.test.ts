import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { BuilderKind, FeedItemKind } from "@prisma/client";
import { isAdminEmail } from "../src/lib/admin";
import {
  builderLibraryKey,
  canonicalBuilderKey,
  canonicalBuilderValueForInput,
  normalizeHandle,
} from "../src/lib/builder-keys";
import { DEFAULT_DIGEST_PROMPTS } from "../src/lib/digest-prompts";
import {
  digestCandidateLimitForLastRun,
  digestMaxAgeCutoff,
  digestMaxPostAgeDays,
} from "../src/lib/feed-preferences";
import { prioritizeSourceCoverage } from "../src/lib/feed-candidate-ordering";
import { DEFAULT_SOURCE_CONFIGS } from "../src/lib/source-config-seed";
import { checkBodyContentQuality } from "../src/lib/content-quality";
import {
  buildRecommendationSignals,
  scoreRecommendation,
  type RecommendationCandidate,
} from "../src/lib/recommendations";
import {
  parseSkillBuilderSyncPayload,
  parseSkillDigestPayload,
} from "../src/lib/skill-contracts";
import { resolvePersonalBuilderInput } from "../src/lib/personal-builder-input";
import {
  candidateSearchTerms,
  didYouMeanSearch,
  mergeSearchSuggestions,
  normalizeRecentSearches,
  parseSearchQuery,
  relatedSearchSuggestions,
  rankSearchDocuments,
  searchSiteFromUrl,
  searchHighlightTerms,
  shouldUseCorrectedSearch,
  stripNegativeSearchQueryOperators,
  stripSearchQueryOperators,
  withSiteSearchOperator,
  normalizeSearchSort,
  normalizeSearchTime,
  normalizeSearchMode,
} from "../src/lib/search";

function assertOrderedText(text: string, markers: string[]) {
  let lastIndex = -1;
  for (const marker of markers) {
    const index = text.indexOf(marker);
    assert.notEqual(index, -1, `missing marker: ${marker}`);
    assert.ok(index > lastIndex, `marker out of order: ${marker}`);
    lastIndex = index;
  }
}
import {
  builderSourceLabel,
  builderKindForSourceType,
  feedItemKindLabel,
  sourceDefinitionForType,
  sourceDefinitionForBuilder,
  sourceTypeIdForBuilder,
} from "../src/lib/source-registry";
import { hashToken, newAgentToken } from "../src/lib/tokens";

test("agent token format is opaque bearer token with stable hash", () => {
  const token = newAgentToken();

  assert.match(token, /^bb_[A-Za-z0-9_-]{40,}$/);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), token);
});

test("admin user path is restricted to configured admin emails", () => {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "admin@example.com, jie@worldstatelabs.com";
  try {
    assert.equal(isAdminEmail("admin@example.com"), true);
    assert.equal(isAdminEmail("JIE@WORLDSTATELABS.COM"), true);
    assert.equal(isAdminEmail("user@example.com"), false);
    assert.equal(isAdminEmail(null), false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
});

test("builder libraryKey scopes per owner; canonicalKey is shared across users", () => {
  const canonicalKey = canonicalBuilderKey(BuilderKind.X, normalizeHandle(" @OpenAI "));

  assert.equal(canonicalKey, "X:openai");
  // Two distinct users get two distinct libraryKeys for the same canonical creator, so
  // the channel/library facet stays per-user while the entity (canonicalKey) is shared.
  assert.equal(
    builderLibraryKey({ ownerUserId: "user_a", canonicalKey }),
    "user:user_a:X:openai",
  );
  assert.equal(
    builderLibraryKey({ ownerUserId: "user_b", canonicalKey }),
    "user:user_b:X:openai",
  );
});

test("manual builder input derives canonical fields from one handle or URL", async () => {
  const xResult = await resolvePersonalBuilderInput({
    displayName: "DeepMind",
    sourceType: "x",
    sourceValue: "https://x.com/GoogleDeepMind",
  });
  assert.ok(xResult.ok);
  assert.deepEqual(xResult.value, {
    kind: BuilderKind.X,
    sourceType: "x",
    name: "DeepMind",
    handle: "googledeepmind",
    sourceUrl: "https://x.com/googledeepmind",
    fetchUrl: null,
  });

  const ytResult = await resolvePersonalBuilderInput({
    displayName: "",
    sourceType: "youtube",
    sourceValue: "@googledeepmind",
  });
  assert.ok(ytResult.ok);
  assert.deepEqual(ytResult.value, {
    kind: BuilderKind.PODCAST,
    sourceType: "youtube",
    name: "googledeepmind",
    handle: null,
    sourceUrl: "https://www.youtube.com/@googledeepmind",
    fetchUrl: null,
  });

  const podcastResult = await resolvePersonalBuilderInput({
    displayName: "",
    sourceType: "podcast",
    sourceValue: "feeds.example.com/show.xml",
  });
  assert.ok(podcastResult.ok);
  assert.deepEqual(podcastResult.value, {
    kind: BuilderKind.PODCAST,
    sourceType: "podcast",
    name: "feeds.example.com",
    handle: null,
    sourceUrl: "https://feeds.example.com/show.xml",
    fetchUrl: null,
  });

  const githubTrendingResult = await resolvePersonalBuilderInput({
    displayName: "",
    sourceType: "github_trending",
    sourceValue: "https://example.com/ignored",
  });
  assert.ok(githubTrendingResult.ok);
  assert.deepEqual(githubTrendingResult.value, {
    kind: BuilderKind.WEBSITE,
    sourceType: "github_trending",
    name: "GitHub Trending",
    handle: null,
    sourceUrl: "https://github.com/trending?since=daily",
    fetchUrl: "https://github.com/trending?since=daily",
  });

  const productHuntResult = await resolvePersonalBuilderInput({
    displayName: "",
    sourceType: "product_hunt_top_products",
    sourceValue: "https://example.com/ignored",
  });
  assert.ok(productHuntResult.ok);
  assert.deepEqual(productHuntResult.value, {
    kind: BuilderKind.WEBSITE,
    sourceType: "product_hunt_top_products",
    name: "Product Hunt Top Products",
    handle: null,
    sourceUrl: "https://www.producthunt.com/",
    fetchUrl: "https://www.producthunt.com/",
  });
});

test("personal YouTube sync cannot create a duplicate builder through handle metadata", () => {
  const sourceUrl = "https://www.youtube.com/@googledeepmind";

  assert.equal(
    canonicalBuilderKey(
      BuilderKind.PODCAST,
      canonicalBuilderValueForInput({
        kind: BuilderKind.PODCAST,
        name: "googledeepmind",
        handle: "googledeepmind",
        sourceUrl,
      }),
    ),
    `PODCAST:${sourceUrl}`,
  );
  assert.equal(
    canonicalBuilderKey(
      BuilderKind.PODCAST,
      canonicalBuilderValueForInput({
        kind: BuilderKind.PODCAST,
        name: "googledeepmind",
        handle: null,
        sourceUrl,
      }),
    ),
    `PODCAST:${sourceUrl}`,
  );
  assert.equal(
    canonicalBuilderValueForInput({
      kind: BuilderKind.X,
      name: "Google DeepMind",
      handle: "@GoogleDeepMind",
      sourceUrl: "https://x.com/googledeepmind",
    }),
    "googledeepmind",
  );
});

test("non-admin users default-import the admin community library and digest", () => {
  const builderPool = readFileSync("src/lib/builder-pool.ts", "utf8");
  const buildersPage = readFileSync("src/app/(workspace)/builders/page.tsx", "utf8");
  const dashboardPage = readFileSync("src/app/(workspace)/dashboard/page.tsx", "utf8");
  const hubPage = readFileSync("src/app/(workspace)/library-hub/page.tsx", "utf8");
  const hubImportRoute = readFileSync("src/app/api/library-hub/imports/route.ts", "utf8");
  const libraryHub = readFileSync("src/lib/library-hub.ts", "utf8");
  const userSearch = readFileSync("src/lib/user-search.ts", "utf8");

  assert.match(builderPool, /activePoolBuilderIds/);
  assert.match(builderPool, /ensureDefaultCommunityLibraryImport\(userId\)/);
  assert.match(builderPool, /if \(!user \|\| isAdminEmail\(user\.email\)\)/);
  assert.match(builderPool, /userLibraryVisibility/);
  assert.match(builderPool, /isFeatured:\s*true/);
  assert.match(builderPool, /findOrCreateDefaultCommunityLibrary/);
  assert.match(builderPool, /adminEmails\(\)/);
  assert.match(builderPool, /BuilderPoolOrigin\.HUB_IMPORT/);
  assert.match(builderPool, /libraryImport\.create/);
  assert.match(libraryHub, /removeLibraryImportFromHub/);
  assert.match(libraryHub, /reachability\.survivingEntityIds/);
  assert.match(libraryHub, /removableBuilderIds/);
  assert.match(libraryHub, /hidden: true/);
  assert.match(libraryHub, /setLibraryHidden/);
  assert.match(hubImportRoute, /export async function DELETE/);
  assert.match(buildersPage, /ensureDefaultCommunityLibraryImport\(session\.user\.id\)/);
  assert.match(buildersPage, /ensureDefaultCommunityDigestImport\(session\.user\.id\)/);
  assert.match(hubPage, /ensureDefaultCommunityLibraryImport\(session\.user\.id\)/);
  assert.match(hubPage, /ensureDefaultCommunityDigestImport\(session\.user\.id\)/);
  assert.match(dashboardPage, /ensureDefaultCommunityDigestImport\(userId\)/);
  assert.match(userSearch, /ensureDefaultCommunityDigestImport\(userId\)/);
  assert.match(libraryHub, /adminCommunityDigestTitle = "Community AI Digest"/);
  assert.match(libraryHub, /findAdminCommunityDigestPipeline/);
  assert.match(libraryHub, /findOrCreateAdminCommunityDigestPipeline/);
  assert.match(libraryHub, /ensureDefaultCommunityDigestImport/);
  assert.match(libraryHub, /digestPipelineOwnerLabel/);
  assert.match(libraryHub, /displayDigestPipelineTitleForOwner/);
});

test("personal builder removal deletes its fetched feed items instead of preserving fetch state", () => {
  const libraryRoute = readFileSync("src/app/api/builders/[builderId]/library/route.ts", "utf8");

  assert.match(libraryRoute, /ownerUserId: session\.user\.id/);
  assert.match(libraryRoute, /ownerUserId === session\.user\.id/);
  assert.match(libraryRoute, /prisma\.feedItem\.deleteMany/);
  assert.match(libraryRoute, /prisma\.builder\.delete/);
  assert.match(libraryRoute, /deletedFeedItems/);
  assert.match(libraryRoute, /BuilderPoolOrigin\.HUB_IMPORT/);
});

test("skill sync user path accepts personal YouTube builders with synced feed items", () => {
  const parsed = parseSkillBuilderSyncPayload({
    force: true,
    builders: [
      {
        builderId: "builder_youtube_1",
        kind: "PODCAST",
        sourceType: "YOUTUBE",
        name: "OpenAI YouTube",
        sourceUrl: "https://www.youtube.com/@OpenAI",
        fetchUrl: "https://www.youtube.com/@OpenAI",
        subscribe: true,
        items: [
          {
            kind: "PODCAST_EPISODE",
            externalId: "video123",
            title: "Workspace agents in ChatGPT",
            body: "Transcript or feed description",
            summary:
              "这条 YouTube 更新概述 Workspace agents 的能力和用途。来源：https://www.youtube.com/watch?v=video123",
            url: "https://www.youtube.com/watch?v=video123",
            publishedAt: "2026-05-22T10:00:00.000Z",
            rawJson: { source: "personal-youtube" },
          },
        ],
      },
    ],
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.force, true);
  assert.equal(parsed.data.builders[0].kind, BuilderKind.PODCAST);
  assert.equal(parsed.data.builders[0].builderId, "builder_youtube_1");
  assert.equal(parsed.data.builders[0].sourceType, "YOUTUBE");
  assert.equal(parsed.data.builders[0].subscribe, true);
  assert.equal(parsed.data.builders[0].items[0].kind, FeedItemKind.PODCAST_EPISODE);
  assert.match(parsed.data.builders[0].items[0].summary ?? "", /Workspace agents/);
  assert.equal(parsed.data.fetchTool, "Agent skill sync");
  assert.equal(parsed.data.builders[0].items[0].fetchTool, undefined);
});

test("skill sync route binds agent task items to referenced personal builders", () => {
  const route = readFileSync("src/app/api/skill/builders/route.ts", "utf8");

  assert.match(route, /findExistingPersonalBuilderForSync/);
  assert.match(route, /builderIdFromItems/);
  assert.match(route, /ownerUserId: userId/);
  assert.match(route, /ownerUserId: userId/);
  assert.match(route, /Referenced personal builder was not found/);
});

test("web app serves the agent skill and setup command", () => {
  const settingsPanel = readFileSync("src/components/AgentTokenPanel.tsx", "utf8");
  const skillPromptActions = readFileSync("src/components/SkillPromptActions.tsx", "utf8");
  const buildersPage = readFileSync("src/app/(workspace)/builders/page.tsx", "utf8");
  const dashboardPage = readFileSync("src/app/(workspace)/dashboard/page.tsx", "utf8");
  const cli = readFileSync("scripts/builder-digest.mjs", "utf8");
  const runner = readFileSync("scripts/builder-agent-runner.sh", "utf8");
  const skillFileRoute = readFileSync("src/app/api/skill/files/[file]/route.ts", "utf8");
  const skillJobRoute = readFileSync("src/app/api/skill/jobs/[job]/skill.md/route.ts", "utf8");
  const skillJobAliasRoute = readFileSync("src/app/api/skill/jobs/[job]/route.ts", "utf8");
  const skillJobFiles = readFileSync("src/lib/skill-job-files.ts", "utf8");
  const bootstrapRoute = readFileSync("src/app/api/skill/bootstrap/route.ts", "utf8");
  const skill = readFileSync("skills/builder-blog-digest/SKILL.md", "utf8");
  const libraryOncePrompt = readFileSync("skills/builder-blog-digest/jobs/library-once.md", "utf8");
  const digestOncePrompt = readFileSync("skills/builder-blog-digest/jobs/digest-once.md", "utf8");
  const libraryCronSetupPrompt = readFileSync("skills/builder-blog-digest/jobs/library-cron-setup.md", "utf8");
  const libraryCronStopPrompt = readFileSync("skills/builder-blog-digest/jobs/library-cron-stop.md", "utf8");
  const digestCronStopPrompt = readFileSync("skills/builder-blog-digest/jobs/digest-cron-stop.md", "utf8");
  const digestCronSetupPrompt = readFileSync("skills/builder-blog-digest/jobs/digest-cron-setup.md", "utf8");
  const libraryCronPrompt = readFileSync("skills/builder-blog-digest/jobs/library-cron.md", "utf8");
  const digestCronPrompt = readFileSync("skills/builder-blog-digest/jobs/digest-cron.md", "utf8");

  assert.doesNotMatch(settingsPanel, /Copy setup command/);
  // The bootstrap curl block was intentionally removed from
  // AgentTokenPanel — users now copy the setup prompt from
  // SkillPromptActions, which references the bootstrap route directly.
  assert.doesNotMatch(settingsPanel, /\/api\/skill\/bootstrap/);
  assert.match(buildersPage, /<SkillPromptActions[\s\S]*context="library"/);
  assert.match(buildersPage, /compactOnly/);
  assert.match(buildersPage, /showStop=\{showStopLibraryCron\}/);
  assert.match(buildersPage, /<SkillPromptActions[\s\S]*context="digest"/);
  assert.match(buildersPage, /showStop=\{showStopDigestCron\}/);
  assert.match(dashboardPage, /function DigestEmptyState/);
  assert.match(dashboardPage, /<SkillPromptActions[\s\S]*context="digest"/);
  assert.match(dashboardPage, /<SkillPromptActions[\s\S]*context="library"/);
  assert.match(dashboardPage, /showStop=\{false\}/);
  // Sources loads + passes the account-wide summary language to both helper dialogs.
  assert.match(buildersPage, /userFeedPreference\.findUnique/);
  assert.match(buildersPage, /summaryLanguage: feedPreference\?\.summaryLanguage/);
  assert.match(buildersPage, /summaryLanguage=\{data\.summaryLanguage\}/);
  assert.doesNotMatch(skillPromptActions, /Source sync/);
  assert.doesNotMatch(skillPromptActions, /Run the terminal skill/);
  assert.match(skillPromptActions, /Fetch sources/);
  assert.doesNotMatch(skillPromptActions, /Update sources/);
  assert.match(skillPromptActions, /Build digest/);
  assert.doesNotMatch(skillPromptActions, /Run or schedule/);
  assert.doesNotMatch(skillPromptActions, /onClick=\{\(\) => copyCommand\("once"\)\}/);
  assert.match(skillPromptActions, /async function copyTextToClipboard/);
  assert.match(skillPromptActions, /document\.hasFocus\(\)/);
  assert.match(skillPromptActions, /document\.execCommand\("copy"\)/);
  assert.doesNotMatch(skillPromptActions, /await navigator\.clipboard\.writeText\(command\)/);
  assert.match(skillPromptActions, /Read \$\{promptUrl\} and follow the instructions/);
  assert.match(skillPromptActions, /\/api\/skill\/jobs\/\$\{job\}\/skill\.md/);
  // The single job dialog includes one-time as the first frequency option;
  // recurring selections still pick runtime + cadence and pass both as URL params.
  assert.match(skillPromptActions, /CronConfigDialog/);
  assert.match(skillPromptActions, /FREQUENCY_OPTIONS/);
  assert.match(skillPromptActions, /\{ id: "once", label: "One-time" \}[\s\S]*\{ id: "30m"/);
  assert.match(skillPromptActions, /pickedFreq === "once"/);
  assert.match(skillPromptActions, /target: "once"/);
  assert.match(skillPromptActions, /params\.set\("runtime"/);
  assert.match(skillPromptActions, /params\.set\("freq"/);
  assert.match(skillPromptActions, /Frequency/);
  // The override toggle adds ?force=1; its copy is context-specific (library
  // re-fetches already-saved posts, digest re-includes already-digested posts
  // additively — the digest job never fetches and never deletes past digests).
  // Both cron + once dialogs expose it for both contexts, defaulting off.
  assert.match(skillPromptActions, /OVERRIDE_COPY/);
  assert.match(skillPromptActions, /Refresh posts already saved/);
  assert.match(skillPromptActions, /Include already digested posts/);
  assert.match(skillPromptActions, /overrideFetched/);
  assert.match(skillPromptActions, /params\.set\("force", "1"\)/);
  // One-time runs now share the schedule dialog instead of a separate button/dialog.
  assert.doesNotMatch(skillPromptActions, /<OnceConfigDialog/);
  assert.match(skillPromptActions, /continueOnceCopy/);
  // Cron + once dialogs: compact <select> controls, plus an account-wide
  // summary language select persisted via /api/settings/summary-language —
  // now shown for digest as well as library.
  assert.match(skillPromptActions, /Copy a prompt for your Local Agent to fetch, summarize, and sync every source\./);
  assert.match(skillPromptActions, /Copy a prompt for your Local Agent to build your AI Digest\./);
  assert.doesNotMatch(skillPromptActions, /build your digest\./);
  assert.doesNotMatch(skillPromptActions, /build new digests|update every source/);
  assert.match(skillPromptActions, /Local Agent/);
  assert.match(skillPromptActions, /Already digested posts can be included again this time\./);
  assert.match(skillPromptActions, /Fetch post age \(days\)/);
  assert.match(skillPromptActions, /Defaults to 30 days\. Choose 1-90 days\./);
  assert.match(skillPromptActions, /params\.set\("days", String\(extras\.fetchDays\)\)/);
  assert.match(skillPromptActions, /Number\.isInteger\(numeric\)/);
  assert.match(skillPromptActions, /numeric < 1 \|\| numeric > MAX_PROMPT_WINDOW_DAYS/);
  assert.doesNotMatch(skillPromptActions, /Math\.min\(MAX_PROMPT_WINDOW_DAYS, Math\.max\(1/);
  assert.match(skillPromptActions, /Max post age must be a whole number from 1 to 90 days/);
  assert.match(skillPromptActions, /Fetch days must be a whole number from 1 to 90 days/);
  assert.match(skillPromptActions, /\{submitting \? "…" : "Copy"\}/);
  assert.doesNotMatch(skillPromptActions, /Copy a prompt for one run or for a recurring local schedule/);
  assert.doesNotMatch(skillPromptActions, /Local helper|connected helpers|Connected helpers/);
  assert.match(skillPromptActions, /No access keys yet/);
  assert.doesNotMatch(skillPromptActions, /Saved for future summaries/);
  assert.doesNotMatch(skillPromptActions, /Posts published more than this many days ago are excluded/);
  assert.doesNotMatch(skillPromptActions, /token-picker-grouplabel">Schedule/);
  assert.doesNotMatch(skillPromptActions, /token-picker-grouplabel">Output/);
  assert.match(skillPromptActions, /cron-field-select/);
  assert.match(skillPromptActions, /Summary language/);
  assert.match(skillPromptActions, /AI Digest language/);
  assert.match(skillPromptActions, /label=\{context === "digest" \? "AI Digest language" : "Summary language"\}/);
  assert.match(skillPromptActions, /languageOptions\(value\)/);
  assert.match(skillPromptActions, /const savedLanguage = summaryLanguage \?\? null/);
  assert.match(skillPromptActions, /const initialLanguage = savedLanguage \?\? ORIGINAL_CONTENT_LANGUAGE_VALUE/);
  assert.match(skillPromptActions, /persistSummaryLanguage\(pickedLanguage, savedLanguage\)/);
  assert.match(skillPromptActions, /persistSummaryLanguage/);
  assert.match(skillPromptActions, /\/api\/settings\/summary-language/);
  const settingsFields = readFileSync("src/components/settings/SettingsFields.tsx", "utf8");
  assert.match(settingsFields, /ORIGINAL_CONTENT_LANGUAGE_VALUE/);
  assert.match(settingsFields, /Use \$\{ORIGINAL_CONTENT_LANGUAGE_LABEL\.toLowerCase\(\)\}/);
  // Account-wide summary language is wired end to end: dedicated save route,
  // schema field, and context override.
  const summaryLanguageRoute = readFileSync(
    "src/app/api/settings/summary-language/route.ts",
    "utf8",
  );
  const prismaSchema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(summaryLanguageRoute, /userFeedPreference\.upsert/);
  assert.match(summaryLanguageRoute, /summaryLanguage/);
  assert.match(prismaSchema, /summaryLanguage\s+String\?/);
  assert.match(prismaSchema, /headlineSummary\s+String\?/);
  // Server validates freq against a whitelist → fixed cron expression and
  // substitutes the schedule + cadence label into the cron-setup prompt.
  assert.match(skillJobRoute, /cronSchedules/);
  assert.match(skillJobRoute, /searchParams\.get\("freq"\)/);
  assert.match(skillJobRoute, /searchParams\.get\("days"\)/);
  assert.match(skillJobRoute, /\{\{FETCH_DAYS\}\}/);
  assert.match(skillJobRoute, /\{\{CRON_FREQUENCY_KEY\}\}/);
  assert.match(skillJobRoute, /\{\{CRON_SCHEDULE\}\}/);
  assert.match(skillJobRoute, /\{\{CRON_FREQUENCY_LABEL\}\}/);
  // macOS scheduling uses a launchd LaunchAgent (keychain access); the route
  // provides a launchd schedule fragment per cadence.
  assert.match(skillJobRoute, /launchdSchedules/);
  assert.match(skillJobRoute, /\{\{LAUNCHD_SCHEDULE\}\}/);
  // Forced re-fetch toggle: ?force=1 → {{FETCH_FORCE}} substituted to 1.
  assert.match(skillJobRoute, /searchParams\.get\("force"\)/);
  assert.match(skillJobRoute, /\{\{FETCH_FORCE\}\}/);
  // {{FETCH_FLAG}} bakes --force straight into the once command; the files
  // route neutralizes it to "" for the runner-fed copy.
  assert.match(skillJobRoute, /\{\{FETCH_FLAG\}\}/);
  assert.match(skillFileRoute, /\{\{FETCH_FLAG\}\}/);
  assert.match(skillFileRoute, /\{\{FETCH_DAYS\}\}/);
  assert.match(skillFileRoute, /replaceAll\("\{\{FETCH_DAYS\}\}", "30"\)/);
  // cron-setup prompts use the placeholders, not a hard-coded schedule, and
  // install via launchd on macOS / crontab on Linux.
  assert.match(libraryCronSetupPrompt, /\{\{CRON_SCHEDULE\}\}/);
  assert.match(libraryCronSetupPrompt, /\{\{CRON_FREQUENCY_KEY\}\}/);
  assert.match(libraryCronSetupPrompt, /\{\{CRON_FREQUENCY_LABEL\}\}/);
  assert.match(libraryCronSetupPrompt, /\{\{LAUNCHD_SCHEDULE\}\}/);
  assert.match(libraryCronSetupPrompt, /launchctl bootstrap/);
  assert.match(libraryCronSetupPrompt, /LaunchAgents/);
  assert.doesNotMatch(libraryCronSetupPrompt, /0 \*\/6 \* \* \*/);
  assert.match(digestCronSetupPrompt, /\{\{CRON_SCHEDULE\}\}/);
  assert.match(digestCronSetupPrompt, /\{\{LAUNCHD_SCHEDULE\}\}/);
  assert.match(digestCronSetupPrompt, /launchctl bootstrap/);
  assert.doesNotMatch(digestCronSetupPrompt, /0 8 \* \* \*/);

  // Digest "re-generate today's digest": the same ?force=1 channel drives
  // digest-specific placeholders. The once command bakes --regenerate inline;
  // the cron flow pins it to disk and the runner re-exports it.
  assert.match(skillJobRoute, /\{\{DIGEST_REGENERATE\}\}/);
  assert.match(skillJobRoute, /\{\{DIGEST_REGENERATE_FLAG\}\}/);
  assert.match(digestOncePrompt, /\{\{DIGEST_REGENERATE_FLAG\}\}/);
  assert.match(digestCronPrompt, /BUILDER_BLOG_DIGEST_REGENERATE/);
  assert.match(digestCronSetupPrompt, /\{\{DIGEST_REGENERATE\}\}/);
  assert.match(digestCronSetupPrompt, /regenerate-digest-cron/);
  assert.match(runner, /BUILDER_BLOG_DIGEST_REGENERATE/);
  assert.match(runner, /read_pin regenerate/);
  assert.match(cli, /--regenerate/);
  assert.match(cli, /&regenerate=1/);
  assert.match(cli, /&dryRun=1/);
  assert.match(cli, /source=\$\{encodeURIComponent\(runSource\)\}/);
  assert.match(cli, /regenerateDigest/);
  assert.match(cli, /cron-status/);
  assert.match(cli, /api\/skill\/cron-jobs/);
  // The digest-writing instructions (incl. the context.language rule) now live
  // in the shared digest-task-contract include, pulled into both digest jobs.
  // The contract's content is asserted below where it's read (digestTaskContract).
  assert.match(digestOncePrompt, /\{\{INCLUDE:digest-task-contract\}\}/);
  assert.match(digestCronPrompt, /\{\{INCLUDE:digest-task-contract\}\}/);
  // Regenerate is additive: it never deletes past digests or digestedItem
  // markers — it re-includes already-digested candidates and re-points each
  // presented post's provenance to the new digest. It also records the
  // account-wide language.
  const digestCreateRoute = readFileSync(
    "src/app/api/skill/digests/route.ts",
    "utf8",
  );
  assert.match(digestCreateRoute, /regenerate/);
  assert.doesNotMatch(digestCreateRoute, /deleteMany/);
  assert.match(digestCreateRoute, /digestedItem\.upsert/);
  assert.match(digestCreateRoute, /summaryLanguage/);
  assert.doesNotMatch(skillPromptActions, /\/api\/skill\/bootstrap/);
  assert.doesNotMatch(skillPromptActions, /BUILDER_BLOG_PROMPT_URL/);
  assert.doesNotMatch(skillPromptActions, /builder-agent-runner\.sh \$\{job\}/);
  assert.doesNotMatch(skillPromptActions, /Run the commands exactly in order/);
  // The fetch-task / summarize execution contract is a single shared
  // fragment; library-once and library-cron pull it in via an
  // {{INCLUDE:...}} directive expanded server-side. Tests assert on the
  // EXPANDED prompt (what the agent actually receives) plus the directive
  // itself, so the contract can live in exactly one place and the two
  // jobs can never drift.
  const fetchTaskContract = readFileSync(
    "skills/builder-blog-digest/jobs/_fetch-task-contract.md",
    "utf8",
  );
  const digestTaskContract = readFileSync(
    "skills/builder-blog-digest/jobs/_digest-task-contract.md",
    "utf8",
  );
  // Summary language is no longer hardcoded to Chinese — the contract defers to
  // the per-run language stated in summaryInstructions.prompt, which is what
  // lets the account-wide summary-language setting actually take effect.
  assert.doesNotMatch(fetchTaskContract, /concise Chinese/);
  assert.match(fetchTaskContract, /output language/);
  // Digest output language defers to context.language (default Chinese), not a
  // hard-coded "concise Chinese digest".
  assert.match(digestTaskContract, /context\.language/);
  assert.doesNotMatch(digestTaskContract, /concise Chinese digest/);
  // Language is fully driven by context.language now — no hardcoded Chinese default.
  assert.doesNotMatch(digestTaskContract, /defaults? (to )?simplified Chinese/i);
  function expandIncludes(content: string): string {
    return content
      .replace(
        /\{\{INCLUDE:fetch-task-contract REPORT_TARGET="([^"]*)"\}\}/g,
        (_m, target) =>
          fetchTaskContract
            .replace(/^\s*<!--[\s\S]*?-->\s*/, "")
            .replaceAll("{{REPORT_TARGET}}", target)
            .trim(),
      )
      .replace(
        /\{\{INCLUDE:digest-task-contract\}\}/g,
        () => digestTaskContract.replace(/^\s*<!--[\s\S]*?-->\s*/, "").trim(),
      );
  }
  const libraryOnceExpanded = expandIncludes(libraryOncePrompt);
  const libraryCronExpanded = expandIncludes(libraryCronPrompt);
  const digestOnceExpanded = expandIncludes(digestOncePrompt);
  const digestCronExpanded = expandIncludes(digestCronPrompt);

  // Anti-drift: both library jobs reference the shared contract via the
  // directive, and neither raw file restates the execution steps inline.
  assert.match(libraryOncePrompt, /\{\{INCLUDE:fetch-task-contract REPORT_TARGET="to the user"\}\}/);
  assert.match(libraryCronPrompt, /\{\{INCLUDE:fetch-task-contract REPORT_TARGET="to the scheduled job log"\}\}/);
  assert.doesNotMatch(libraryOncePrompt, /How to execute each `fetchTask`/);
  assert.doesNotMatch(libraryCronPrompt, /How to execute each `fetchTask`/);
  // Expansion leaves no unresolved placeholders.
  assert.doesNotMatch(libraryOnceExpanded, /\{\{INCLUDE|\{\{REPORT_TARGET\}\}/);
  assert.doesNotMatch(libraryCronExpanded, /\{\{INCLUDE|\{\{REPORT_TARGET\}\}/);
  // REPORT_TARGET is substituted per job.
  assert.match(libraryOnceExpanded, /Action needed" notice and skip[\s\S]*to the user/);
  assert.match(libraryCronExpanded, /Action needed" notice and skip[\s\S]*to the scheduled job log/);

  // Contract content, asserted on the expanded once-prompt.
  assert.match(libraryOnceExpanded, /fetch-personal --days \{\{FETCH_DAYS\}\} --limit 3/);
  assert.match(libraryOnceExpanded, /validate-agent-sync/);
  assert.match(libraryOnceExpanded, /sync-builders/);
  assert.match(libraryOnceExpanded, /rawJson\.agentExecutionProof/);
  assert.match(libraryOnceExpanded, /complete exactly\s+the task IDs returned by the CLI/i);
  assert.match(libraryOnceExpanded, /fetchTasks/);
  assert.match(libraryOnceExpanded, /single-post\s+`?summary`?/);
  assert.match(libraryOnceExpanded, /summaryInstructions\.prompt/);
  assert.match(libraryOnceExpanded, /only prompt source for fetch-task\s+summaries/);
  assert.match(libraryOnceExpanded, /Do not re-compose it from[\s\S]*`context\.sources`/);
  assert.match(libraryOnceExpanded, /Fetch task boundary/);
  assert.match(libraryOnceExpanded, /How to execute each `fetchTask`/);
  assert.match(libraryOnceExpanded, /Read `task\.contentStatus`/);
  assert.match(libraryOnceExpanded, /Copy `task\.builderSync` exactly/);
  assert.match(libraryOnceExpanded, /Use `task\.minimumContentQuality`/);
  assert.match(libraryOnceExpanded, /Build one output item/);
  assert.match(libraryOnceExpanded, /both `body` and `summary`/);
  assert.match(libraryOnceExpanded, /task\.builderSync/);
  assert.doesNotMatch(libraryOnceExpanded, /agentTasks/);
  assert.doesNotMatch(libraryOnceExpanded, /summaryTasks/);
  assert.doesNotMatch(libraryOnceExpanded, /summarize-tweets\.md/);
  assert.doesNotMatch(libraryOnceExpanded, /summarize-podcast\.md/);
  assert.doesNotMatch(libraryOnceExpanded, /summarize-blogs\.md/);
  assert.match(libraryOnceExpanded, /Do not add new sources, URLs, or feed items/);
  // library-once carries a per-run --force toggle inline via {{FETCH_FLAG}}
  // (the jobs route substitutes it from ?force=, the files route neutralizes
  // it to ""). The old blanket "Do not use --force." is replaced by guidance
  // to run the command verbatim.
  assert.match(
    libraryOnceExpanded,
    /fetch-personal --days \{\{FETCH_DAYS\}\} --limit 3 \{\{FETCH_FLAG\}\}/,
  );
  assert.match(libraryOnceExpanded, /Do not add or remove `--force`\s+yourself/);
  assert.doesNotMatch(libraryOnceExpanded, /Do not use `--force`\./);
  assert.match(libraryOnceExpanded, /execution\s+contract, not as user-facing documentation/);
  assert.doesNotMatch(libraryOnceExpanded, /Environment contract/);
  assertOrderedText(libraryOnceExpanded, [
    "3. Print the fetch result",
    "How to execute each `fetchTask`",
    "sync-builders",
    "5. Report the fetch JSON",
  ]);
  // The cron job's expanded prompt carries the identical contract.
  assert.match(libraryCronExpanded, /How to execute each `fetchTask`/);
  assert.match(libraryCronExpanded, /Build one output item/);
  assert.match(libraryCronExpanded, /validate-agent-sync/);
  // Both routes expand includes.
  assert.match(skillFileRoute, /expandSkillIncludes/);
  assert.match(skillJobRoute, /expandSkillIncludes/);
  // The shared fragment is read at runtime via readFile, so it MUST be in
  // outputFileTracingIncludes for both routes that expand includes — else
  // Vercel's serverless bundle omits it and the routes 500. (This class of
  // bug can't be caught by tsc/tests at runtime, only by this guard.)
  const nextConfig = readFileSync("next.config.ts", "utf8");
  const tracingForFilesRoute = nextConfig.slice(
    nextConfig.indexOf('"/api/skill/files/[file]"'),
    nextConfig.indexOf('"/api/skill/jobs/[job]/skill.md"'),
  );
  const tracingForJobsRoute = nextConfig.slice(
    nextConfig.indexOf('"/api/skill/jobs/[job]/skill.md"'),
  );
  assert.match(tracingForFilesRoute, /_fetch-task-contract\.md/);
  assert.match(tracingForJobsRoute, /_fetch-task-contract\.md/);
  // Every job the [job]/skill.md route can serve must be in its tracing list,
  // or that job 500s (ENOENT) on Vercel even though it works locally. Derive
  // the set from the registry so a newly-added job can't be forgotten here
  // (this is exactly how library-cron-stop slipped through and 500'd in prod).
  const registeredJobFiles = [
    ...skillJobFiles.matchAll(/jobs\/([a-z0-9-]+\.md)/g),
  ].map((m) => m[1]);
  assert.ok(registeredJobFiles.length >= 7, "expected jobSkillFiles to parse");
  for (const file of registeredJobFiles) {
    assert.ok(
      tracingForJobsRoute.includes(file),
      `next.config.ts outputFileTracingIncludes for the jobs route is missing ${file} — that job will 500 (ENOENT) on Vercel`,
    );
  }
  assert.match(digestOncePrompt, /builder-digest\.mjs" prepare \{\{DIGEST_REGENERATE_FLAG\}\}/);
  assert.doesNotMatch(digestOncePrompt, /prepare --days/);
  assert.match(digestOncePrompt, /Use agent judgment only for the structured summary JSON step/);
  assert.match(digestOncePrompt, /execution\s+contract, not as user-facing documentation/);
  assert.doesNotMatch(digestOncePrompt, /Environment contract/);
  // Anti-drift: the digest-writing method lives in the shared partial included
  // by both digest jobs. The expanded prompt references the current structured
  // output contract, not disk prompt files or agent-authored final markdown.
  assert.match(digestOncePrompt, /\{\{INCLUDE:digest-task-contract\}\}/);
  assert.doesNotMatch(digestOnceExpanded, /\{\{INCLUDE/);
  assert.match(digestOnceExpanded, /builder-blog-digest-agent-output\.json/);
  assert.match(digestOnceExpanded, /context\.digest\.headlinePrompt/);
  assert.doesNotMatch(digestOnceExpanded, /300 characters or fewer/);
  assert.doesNotMatch(digestOnceExpanded, /200,000-character sync limit/);
  assert.match(digestOnceExpanded, /context\.digest\.perSourceSummaryPrompt/);
  assert.match(digestOnceExpanded, /context\.digest\.translate/);
  assert.doesNotMatch(digestOnceExpanded, /context\.digest\.digestIntro/);
  assert.match(digestOncePrompt, /render-digest/);
  assert.match(digestOnceExpanded, /headlineSummary/);
  assert.match(digestOncePrompt, /BUILDER_BLOG_JOB_TMP_DIR/);
  assert.match(digestOncePrompt, /builder-blog-digest-headlines\.txt/);
  assert.match(digestOncePrompt, /--summary-file "\$TMP_DIR\/builder-blog-digest-headlines\.txt"/);
  assert.match(digestOncePrompt, /--context "\$TMP_DIR\/builder-blog-context\.json"/);
  assert.match(libraryCronSetupPrompt, /builder-agent-runner\.sh library-cron/);
  assert.match(libraryCronSetupPrompt, /BUILDER_BLOG_DISABLE_WEB_SYNC=1/);
  assert.match(libraryCronSetupPrompt, /webSyncDisabled: true/);
  assert.match(libraryCronStopPrompt, /cron-status/);
  assert.match(libraryCronStopPrompt, /--status stopped/);
  assert.match(libraryCronStopPrompt, /ACCT="\$\{BUILDER_BLOG_ACCOUNT\}"/);
  assert.doesNotMatch(libraryCronStopPrompt, /Do not\s+exchange a token or make any network call/);
  assert.match(digestCronSetupPrompt, /BUILDER_BLOG_DISABLE_WEB_SYNC=1/);
  assert.match(digestCronSetupPrompt, /webSyncDisabled: true/);
  assert.match(digestCronSetupPrompt, /--job digest-cron/);
  assert.match(digestCronSetupPrompt, /--regenerate "\{\{DIGEST_REGENERATE\}\}"/);
  assert.match(digestCronStopPrompt, /cron-status/);
  assert.match(digestCronStopPrompt, /--job digest-cron/);
  assert.match(digestCronStopPrompt, /--status stopped/);
  assert.match(digestCronStopPrompt, /ACCT="\$\{BUILDER_BLOG_ACCOUNT\}"/);
  assert.doesNotMatch(digestCronStopPrompt, /Do not\s+exchange a token or make any network call/);
  // Setup now pins the chosen runtime in an account-scoped pin file so the
  // runner picks the matching unattended-mode invocation at cron-fire time
  // without sharing runtime choice across FollowBrief accounts.
  assert.match(libraryCronSetupPrompt, /\{\{AGENT_RUNTIME\}\}/);
  assert.match(libraryCronSetupPrompt, /\{\{AGENT_RUNTIME_LABEL\}\}/);
  // Setup prompts must run standalone — no other skills/plugins/subagents, so
  // a host agent (OMC, superpowers, etc.) doesn't derail the deterministic
  // install steps.
  assert.match(libraryCronSetupPrompt, /Do not\s+invoke any other\s+skill, plugin, or subagent/);
  assert.match(digestCronSetupPrompt, /Do not\s+invoke any other\s+skill, plugin, or subagent/);
  assert.match(libraryCronSetupPrompt, /Pin the scheduled runtime/);
  // Pin files are per-account and per-job so multiple FollowBrief accounts and
  // job types can use different runtimes on one machine.
  assert.match(libraryCronSetupPrompt, /ACCOUNT_SLUG/);
  assert.match(libraryCronSetupPrompt, /runtime-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronSetupPrompt, /6\. Install the schedule/);
  assert.match(libraryCronSetupPrompt, /crontab/);
  assert.match(libraryCronSetupPrompt, /Do not use `--force`/);
  assert.match(libraryCronSetupPrompt, /fetchTasks/);
  // Pre-install detection: list existing same-type crons and require explicit
  // override confirmation before replacing.
  assert.match(libraryCronSetupPrompt, /com\\?\.followbrief\\?\.library\\?\./);
  assert.match(libraryCronSetupPrompt, /builder-agent-runner\\?\.sh library-cron/);
  assert.match(libraryCronSetupPrompt, /launchctl list/);
  assert.match(libraryCronSetupPrompt, /grep -x "\$LABEL"/);
  assert.match(libraryCronSetupPrompt, /the user whether to\s+override/);
  assert.match(libraryCronSetupPrompt, /\(none found\)/);
  // The smoke check delegates to the runner (library-cron); cron-setup must
  // NOT restate the fetch-task execution steps — that's library-cron's job.
  assert.match(libraryCronSetupPrompt, /single source of truth/);
  assert.doesNotMatch(libraryCronSetupPrompt, /How to execute each `fetchTask`/);
  assert.doesNotMatch(libraryCronSetupPrompt, /Read `task\.contentStatus`/);
  assert.doesNotMatch(libraryCronSetupPrompt, /Copy `task\.builderSync`/);
  // Setup delegates fetch-task work to library-cron; it must not restate
  // any of the contract (the "Fetch task boundary" block had drifted).
  assert.doesNotMatch(libraryCronSetupPrompt, /Fetch task boundary/);
  assert.doesNotMatch(libraryCronSetupPrompt, /task\.summaryInstructions\.prompt/);
  assert.doesNotMatch(libraryCronSetupPrompt, /contentStatus="ready"/);
  assertOrderedText(libraryCronSetupPrompt, [
    "account's library fetch cron",
    "4. Pin the scheduled runtime",
    "6. Install the schedule",
    "launchctl bootstrap",
    "7. Run one immediate smoke check",
    "BUILDER_BLOG_DISABLE_WEB_SYNC=1",
    "report its output",
    "8. After the smoke check succeeds",
    "cron-status",
  ]);
  // Override-already-fetched toggle: cron-setup pins fetch-force (0/1) next to
  // the runtime, the runner turns 1 into --force, and library-cron threads the
  // exported flag into the recurring fetch-personal command. Wired end to end
  // because the runner re-downloads library-cron.md fresh each run (files
  // route, no query params), so the choice must persist on disk — a copy-time
  // URL param alone could never reach the recurring fetch.
  assert.match(libraryCronSetupPrompt, /\{\{FETCH_FORCE\}\}/);
  assert.match(libraryCronSetupPrompt, /fetch-force-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronSetupPrompt, /\{\{FETCH_DAYS\}\}/);
  assert.match(libraryCronSetupPrompt, /fetch-days-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronSetupPrompt, /\$LABEL\.log/);
  assert.match(libraryCronPrompt, /BUILDER_BLOG_JOB_TMP_DIR/);
  assert.match(
    libraryCronPrompt,
    /fetch-personal --days \$\{BUILDER_BLOG_FETCH_DAYS:-30\} --limit 3 \$\{BUILDER_BLOG_FETCH_FORCE:-\}/,
  );
  assert.match(digestCronSetupPrompt, /builder-agent-runner\.sh digest-cron/);
  // digest cron-setup pins the runtime too (parity with library) so the
  // scheduled job is self-sufficient even when only the digest cron is
  // installed — without the pin it falls back to the discovery chain, which
  // prompts for permissions every run.
  assert.match(digestCronSetupPrompt, /\{\{AGENT_RUNTIME\}\}/);
  assert.match(digestCronSetupPrompt, /\{\{AGENT_RUNTIME_LABEL\}\}/);
  assert.match(digestCronSetupPrompt, /Pin the scheduled runtime/);
  assert.match(digestCronSetupPrompt, /ACCOUNT_SLUG/);
  assert.match(digestCronSetupPrompt, /runtime-digest-cron-\$ACCOUNT_SLUG/);
  assert.match(digestCronSetupPrompt, /6\. Install the schedule/);
  assert.match(digestCronSetupPrompt, /crontab/);
  // Same pre-install detection + override gate as library.
  assert.match(digestCronSetupPrompt, /com\\?\.followbrief\\?\.digest\\?\./);
  assert.match(digestCronSetupPrompt, /grep -x "\$LABEL"/);
  assert.match(digestCronSetupPrompt, /the user whether to\s+override/);
  assert.match(digestCronSetupPrompt, /\(none found\)/);
  assert.match(digestCronSetupPrompt, /\$LABEL\.log/);
  assert.match(digestCronPrompt, /BUILDER_BLOG_JOB_TMP_DIR/);
  assert.match(digestCronPrompt, /--context "\$TMP_DIR\/builder-blog-context\.json"/);
  assertOrderedText(digestCronSetupPrompt, [
    "account's digest cron",
    "4. Pin the scheduled runtime",
    "6. Install the schedule",
    "launchctl bootstrap",
    "7. Run one immediate smoke check",
    "BUILDER_BLOG_DISABLE_WEB_SYNC=1",
    "report its output",
    "8. After the smoke check succeeds",
    "cron-status",
  ]);
  assert.doesNotMatch(skillPromptActions, /fetch-personal[^\n`]*--force/);
  assert.match(cli, /realpathSync\(fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(cli, /existsSync\(process\.argv\[1\]\)/);
  assert.match(cli, /validate-agent-sync/);
  assert.match(cli, /BUILDER_BLOG_DISABLE_WEB_SYNC/);
  assert.match(cli, /Web sync disabled for smoke check/);
  assert.match(cli, /localErrors/);
  assert.doesNotMatch(cli, /pendingReadyFetchTasks/);
  assert.doesNotMatch(cli, /pendingAgentFetchTasks/);
  assert.doesNotMatch(cli, /pendingFetchBuilders/);
  assert.doesNotMatch(cli, /validatedFetchTaskItems/);
  assert.doesNotMatch(cli, /legacyAgentTasks/);
  assert.doesNotMatch(cli, /legacySummaryTasks/);
  assert.doesNotMatch(cli, /postSummaryTasksForBuilders/);
  assert.doesNotMatch(cli, /normalFetcher/);
  assert.doesNotMatch(cli, /suggestedAction/);
  assert.match(runner, /BUILDER_BLOG_AGENT_COMMAND/);
  assert.match(runner, /BUILDER_BLOG_PROMPT_URL/);
  assert.match(runner, /library-once\|digest-once\|library-cron-setup\|digest-cron-setup\|library-cron\|digest-cron/);
  assert.match(runner, /codex exec --skip-git-repo-check/);
  assert.match(runner, /claude -p/);
  // openclaw 2026.5.20+ requires a session selector, so the runner passes
  // `--agent` between `--local` and `--message`.
  assert.match(runner, /openclaw agent --local --agent .* --message/);
  assert.match(runner, /gemini -p/);
  // Pinned-runtime dispatch for *-cron jobs: each runtime has an
  // _unattended variant with the matching allowlist / auto-approve
  // flags so cron never trips a permission prompt.
  assert.match(runner, /run_with_claude_unattended/);
  assert.match(runner, /run_with_codex_unattended/);
  assert.match(runner, /run_with_gemini_unattended/);
  assert.match(runner, /run_with_openclaw_unattended/);
  assert.match(runner, /--permission-mode acceptEdits/);
  assert.match(runner, /--full-auto/);
  assert.match(runner, /--yolo/);
  // OpenClaw unattended runs rely on its default non-interactive policy and
  // must not rewrite the global exec approval file from a scheduled job.
  assert.match(runner, /openclaw agent --local/);
  assert.match(runner, /don't touch[\s\S]*global policy/);
  assert.doesNotMatch(runner, /exec-policy preset yolo/);
  assert.doesNotMatch(runner, /--auto-approve/);
  // Pins are read per-account and per-job with a fallback to legacy files, so
  // two accounts can run the same job type without sharing runtime or mode.
  assert.match(runner, /read_pin\(\)/);
  assert.match(runner, /ACCOUNT_SLUG/);
  assert.match(runner, /\$AGENT_DIR\/\$1-\$JOB_NAME-\$ACCOUNT_SLUG/);
  assert.match(runner, /\$AGENT_DIR\/\$1-\$JOB_NAME/);
  assert.match(runner, /\$AGENT_DIR\/\$1\b/);
  assert.match(runner, /BUILDER_BLOG_JOB_TMP_DIR/);
  assert.match(runner, /CURRENT_FILE="\$JOB_TMP_DIR\/current\.json"/);
  assert.match(runner, /run_cron_supervisor/);
  assert.match(runner, /Scheduled worker running in launchd foreground/);
  assert.match(runner, /terminate_process_tree/);
  assert.match(runner, /PINNED_RUNTIME="\$\(read_pin runtime\)"/);
  // Forced re-fetch: runner reads the fetch-force pin and exports
  // BUILDER_BLOG_FETCH_FORCE=--force when it's 1, which library-cron threads
  // into the recurring fetch-personal command.
  assert.match(runner, /fetch-force/);
  assert.match(runner, /read_pin fetch-force/);
  assert.match(runner, /BUILDER_BLOG_FETCH_FORCE="--force"/);
  assert.match(runner, /export BUILDER_BLOG_FETCH_FORCE/);
  assert.match(cli, /if \(envAccount\)/);
  assert.match(cli, /if \(envToken\)/);
  assert.ok(
    cli.indexOf("if (envAccount)") < cli.indexOf("if (envToken)"),
    "BUILDER_BLOG_ACCOUNT must win over a bare BUILDER_BLOG_TOKEN for account isolation",
  );
  assert.match(cli, /BUILDER_BLOG_JOB_TMP_DIR/);
  assert.match(cli, /join\(jobTmpDir \|\| join\(agentDir, "tmp"\), "builder-blog-context\.json"\)/);
  assert.match(runner, /No local agent runtime found/);
  // Runner self-updates from the server each run and re-execs the new
  // version, so cron jobs pick up runner fixes without re-running setup;
  // the loop guard prevents an infinite re-exec.
  assert.match(runner, /self_update_and_reexec/);
  assert.match(runner, /BUILDER_BLOG_RUNNER_UPDATED/);
  assert.match(runner, /exec "\$_self" "\$@"/);
  assert.match(runner, /api\/skill\/files\/builder-agent-runner\.sh/);
  assert.match(runner, /fetchTasks/);
  assert.match(runner, /process\.exit\(78\)/);
  assert.match(runner, /refresh_skill_files/);
  assert.match(runner, /api\/skill\/files\/builder-digest\.mjs/);
  assert.match(skillFileRoute, /builder-blog-digest\.md/);
  assert.match(skillFileRoute, /builder-blog-library-once\.md/);
  assert.match(skillFileRoute, /builder-blog-digest-once\.md/);
  assert.match(skillFileRoute, /builder-blog-library-cron-setup\.md/);
  assert.match(skillFileRoute, /builder-blog-digest-cron-setup\.md/);
  assert.match(skillFileRoute, /builder-blog-library-cron\.md/);
  assert.match(skillFileRoute, /builder-blog-digest-cron\.md/);
  assert.match(skillFileRoute, /builder-agent-runner\.sh/);
  assert.match(skillFileRoute, /builder-digest\.mjs/);
  assert.match(skillJobFiles, /library-once/);
  assert.match(skillJobFiles, /digest-once/);
  assert.match(skillJobRoute, /jobSkillFiles/);
  assert.match(skillJobRoute, /text\/markdown/);
  assert.match(skillJobAliasRoute, /jobSkillFiles/);
  assert.match(skillJobAliasRoute, /rel="canonical"/);
  assert.match(bootstrapRoute, /api\/skill\/files\/builder-blog-digest\.md/);
  assert.match(bootstrapRoute, /api\/skill\/files\/builder-digest\.mjs/);
  assert.match(bootstrapRoute, /api\/skill\/files\/builder-agent-runner\.sh/);
  assert.match(bootstrapRoute, /command -v node/);
  assert.match(bootstrapRoute, /FollowBrief requires Node\.js 20 or newer/);
  assert.match(bootstrapRoute, /command -v curl/);
  assert.match(bootstrapRoute, /jobs\/library-once\.md/);
  assert.match(bootstrapRoute, /jobs\/digest-once\.md/);
  assert.match(bootstrapRoute, /jobs\/library-cron-setup\.md/);
  assert.match(bootstrapRoute, /jobs\/digest-cron-setup\.md/);
  assert.match(bootstrapRoute, /jobs\/library-cron\.md/);
  assert.match(bootstrapRoute, /jobs\/digest-cron\.md/);
  assert.match(bootstrapRoute, /Copy prompt button in the web app/);
  // F9: config/sources.json is the single source of truth for content-quality
  // floors / url patterns. bootstrap downloads it so the once-flow (bootstrap →
  // direct CLI, no runner) always has it locally, and the CLI carries NO
  // embedded fallback — a missing file fails loud with an actionable bootstrap
  // hint instead of silently running on guessed values.
  assert.match(bootstrapRoute, /api\/skill\/files\/sources\.json/);
  assert.doesNotMatch(cli, /disallowedPrimarySources:\s*\[/);
  assert.match(cli, /Could not read \$\{SOURCES_CONFIG_PATH\}/);
  assert.match(cli, /Re-run the FollowBrief/);
  assert.match(skill, /Install From Web App/);
  assert.match(skill, /Scheduled Jobs/);
  assert.match(skill, /builder-agent-runner\.sh digest-cron/);
  assert.match(skill, /OpenClaw CLI/);
  assert.match(skill, /validate-agent-sync/);
  assert.match(skill, /failed extraction attempts are not command-contract\s+failures/);
  assert.match(skill, /~\/\.builder-blog\/builder-digest\.mjs/);
  // Cron contract = same shared fragment, asserted on the EXPANDED prompt.
  assert.match(libraryCronExpanded, /fetch-personal --days \$\{BUILDER_BLOG_FETCH_DAYS:-30\} --limit 3/);
  assert.match(libraryCronExpanded, /validate-agent-sync/);
  assert.match(libraryCronExpanded, /sync-builders/);
  assert.match(libraryCronExpanded, /rawJson\.fetchTaskId/);
  assert.match(libraryCronExpanded, /fetchTasks/);
  assert.match(libraryCronExpanded, /single-post\s+`?summary`?/);
  assert.match(libraryCronExpanded, /summaryInstructions\.prompt/);
  assert.match(libraryCronExpanded, /Fetch task boundary/);
  assert.match(libraryCronExpanded, /How to execute each `fetchTask`/);
  assert.match(libraryCronExpanded, /Read `task\.contentStatus`/);
  assert.match(libraryCronExpanded, /Copy `task\.builderSync` exactly/);
  assert.match(libraryCronExpanded, /Use `task\.minimumContentQuality`/);
  assert.match(libraryCronExpanded, /Build one output item/);
  assert.match(libraryCronExpanded, /both `body` and `summary`/);
  assert.match(libraryCronExpanded, /candidate_discovery_fallback/);
  assert.match(libraryCronExpanded, /expand-discovery/);
  assert.match(libraryCronExpanded, /library-discovery-result\.json/);
  assert.match(libraryCronExpanded, /CLI guarantees the expanded `fetchTasks` array contains only normal/);
  assert.match(libraryCronExpanded, /task\.builderSync/);
  assert.match(libraryCronExpanded, /complete exactly\s+the task IDs returned by the CLI/i);
  assert.match(libraryCronExpanded, /Do not add new sources, URLs, or feed items/);
  assert.match(libraryCronExpanded, /[Dd]o not stop\s+just because one extraction method fails/);
  assert.doesNotMatch(libraryCronExpanded, /agentTasks/);
  assert.doesNotMatch(libraryCronExpanded, /summaryTasks/);
  assert.doesNotMatch(libraryCronExpanded, /summarize-tweets\.md/);
  assert.doesNotMatch(libraryCronExpanded, /summarize-podcast\.md/);
  assert.doesNotMatch(libraryCronExpanded, /summarize-blogs\.md/);
  // Cron preamble framing lives in the raw file (per-job, not shared).
  assert.match(libraryCronPrompt, /Run these steps exactly/);
  assert.match(libraryCronPrompt, /Do not ask the user questions/);
  assert.match(libraryCronPrompt, /Agent discretion boundary/);
  assert.match(libraryCronPrompt, /scheduled job\s+log/);
  // Cron jobs run via the runner, which already refreshes everything each
  // run, so the prompt itself has no bootstrap/install step (only the
  // user-invoked once prompts and cron-setup keep bootstrap).
  assert.doesNotMatch(libraryCronPrompt, /api\/skill\/bootstrap/);
  assert.match(libraryCronPrompt, /runner already downloaded the latest skill files/);
  assertOrderedText(libraryCronExpanded, [
    "2. Print the fetch result",
    "How to execute each `fetchTask`",
    "validate-agent-sync",
    "sync-builders",
  ]);
  assert.match(digestCronPrompt, /builder-digest\.mjs" prepare \$\{BUILDER_BLOG_DIGEST_REGENERATE:-\}/);
  assert.doesNotMatch(digestCronPrompt, /prepare --days/);
  assert.match(digestCronPrompt, /builder-blog-digest\.md/);
  assert.match(digestCronPrompt, /Only\s+use agent judgment to write the structured summary JSON/);
  assert.match(digestCronPrompt, /Agent discretion boundary/);
  assert.match(digestCronExpanded, /structured summary JSON/);
  assert.doesNotMatch(digestCronPrompt, /api\/skill\/bootstrap/);
  assert.match(digestCronPrompt, /runner already downloaded the latest skill files/);
  // The recurring run shares the once job's structured output contract via the
  // partial.
  assert.match(digestCronPrompt, /\{\{INCLUDE:digest-task-contract\}\}/);
  assert.doesNotMatch(digestCronExpanded, /\{\{INCLUDE/);
  assert.match(digestCronExpanded, /builder-blog-digest-agent-output\.json/);
  assert.match(digestCronExpanded, /context\.digest\.headlinePrompt/);
  assert.match(digestCronExpanded, /context\.digest\.perSourceSummaryPrompt/);
  assert.match(digestCronExpanded, /context\.digest\.translate/);
  assert.doesNotMatch(digestCronExpanded, /context\.digest\.digestIntro/);
  assert.match(digestCronPrompt, /render-digest/);
  assert.match(digestCronExpanded, /headlineSummary/);
  assert.match(digestCronPrompt, /builder-blog-digest-headlines\.txt/);
  assert.match(digestCronPrompt, /--summary-file "\$TMP_DIR\/builder-blog-digest-headlines\.txt"/);
  assert.doesNotMatch(digestCronExpanded, /summarize-tweets\.md/);
  assert.doesNotMatch(digestCronExpanded, /context\.prompts/);
  assert.equal(skill.includes("/Users/jie/code/builder_blog"), false);
  assert.equal(skill.includes("node scripts/builder-digest.mjs"), false);
});

test("vercel migration wrapper retries Prisma advisory lock timeouts", () => {
  const migrate = readFileSync("scripts/vercel-migrate.mjs", "utf8");
  assert.match(migrate, /"p1002"/);
  assert.doesNotMatch(migrate, /"P1002"/);
  assert.match(migrate, /ADVISORY_LOCK_MARKERS/);
  assert.match(migrate, /timed out trying to acquire a postgres advisory lock/);
  assert.match(migrate, /select pg_advisory_lock/);
  assert.match(migrate, /VERCEL_MIGRATE_MAX_ATTEMPTS/);
  assert.match(migrate, /Retrying \$\{attempt \+ 1\}\/\$\{MAX_ATTEMPTS\}/);
});

test("digest sync user path defaults optional fields and rejects empty content", () => {
  const parsed = parseSkillDigestPayload({
    title: "Personal YouTube Builder Digest",
    content: "Digest body",
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.language, "zh");
  assert.equal(parsed.data.itemCount, 0);
  assert.equal(parsed.data.headlineSummary, undefined);
  // New fields default safely for old callers.
  assert.equal(parsed.data.regenerate, false);
  assert.deepEqual(parsed.data.digestedItems, []);

  // A caller that marks digested posts is accepted and validated.
  const withMarks = parseSkillDigestPayload({
    title: "Digest",
    content: "Body",
    regenerate: true,
    digestedItems: [{ entityId: "e1", kind: "TWEET", externalId: "x1", feedItemId: "fi1" }],
  });
  assert.equal(withMarks.success, true);
  if (withMarks.success) {
    assert.equal(withMarks.data.regenerate, true);
    assert.equal(withMarks.data.digestedItems.length, 1);
    assert.equal(withMarks.data.digestedItems[0].entityId, "e1");
  }

  const withHeadlineSummary = parseSkillDigestPayload({
    title: "Digest",
    content: "Body",
    headlineSummary: "OpenAI 发布新工具；Claude 更新 agents；开发者生态继续加速。",
  });
  assert.equal(withHeadlineSummary.success, true);
  if (withHeadlineSummary.success) {
    assert.equal(
      withHeadlineSummary.data.headlineSummary,
      "OpenAI 发布新工具；Claude 更新 agents；开发者生态继续加速。",
    );
  }

  const tooLongHeadlineSummary = parseSkillDigestPayload({
    title: "Digest",
    content: "Body",
    headlineSummary: "x".repeat(1201),
  });
  assert.equal(tooLongHeadlineSummary.success, false);

  const empty = parseSkillDigestPayload({ title: "Bad", content: "" });
  assert.equal(empty.success, false);
});

test("fetch task success requires a persisted summary; failures are recorded with a reason", () => {
  // Server is the authoritative gate: a no-summary item is a recorded FAILURE
  // (with reason), not a silent skip, and per-task results come back to the CLI.
  const buildersRoute = readFileSync("src/app/api/skill/builders/route.ts", "utf8");
  assert.match(buildersRoute, /itemResults/);
  assert.match(buildersRoute, /reason: "summary_missing"/);
  assert.match(buildersRoute, /status: "failed"/);
  assert.match(buildersRoute, /readFetchTaskId/);
  // Body / crawled-content gate: a post with no real content is also a recorded
  // failure server-side (not just client-side validate), symmetric with summary.
  assert.match(buildersRoute, /checkBodyContentQuality/);
  assert.match(buildersRoute, /contentVerdict/);

  // The fetch-log per-post outcome carries a failure reason.
  const fetchRunsRoute = readFileSync("src/app/api/skill/fetch-runs/[id]/route.ts", "utf8");
  assert.match(fetchRunsRoute, /failureReason/);

  // The CLI reconciles the FULL planned task list against the server result, so
  // a task the agent never summarized is marked failed/not_summarized, not left
  // pending; the server result (not the payload) decides success.
  const cli = readFileSync("scripts/builder-digest.mjs", "utf8");
  assert.match(cli, /not_summarized/);
  assert.match(cli, /serverResult/);
  assert.match(cli, /plannedTasks/);
  assert.match(cli, /library-fetch-result\.json/);

  // The fetch log UI no longer claims "Fetched & summarized" for a ready fetch
  // that has no summary, and renders the failure reason.
  const panel = readFileSync("src/components/FetchLogPanel.tsx", "utf8");
  assert.match(panel, /isSummarized/);
  assert.match(panel, /failureReason/);
  assert.match(panel, /FAILURE_REASON_LABEL/);
  // Banner must key off a persisted summary, not contentStatus === "ready".
  assert.doesNotMatch(panel, /task\.contentStatus === "ready"\s*\|\|\s*s === "fetched"/);

  // The contract tells the agent a task is complete only when synced with a
  // summary, and to not silently drop unsummarized tasks.
  const contract = readFileSync(
    "skills/builder-blog-digest/jobs/_fetch-task-contract.md",
    "utf8",
  );
  assert.match(contract, /complete ONLY when its item is synced with real crawled content/);
  assert.match(contract, /FAILURE/);
});

test("every fetchTask resolves to a terminal state; skips need per-task evidence", () => {
  // Sync contract carries structured per-task outcomes for non-synced tasks.
  const contracts = readFileSync("src/lib/skill-contracts.ts", "utf8");
  assert.match(contracts, /SkillTaskOutcomeSchema/);
  assert.match(contracts, /taskOutcomes/);
  assert.match(contracts, /"skipped", "failed", "blocked"/);

  // Validator enforces evidence-gated skips + full coverage.
  const cli = readFileSync("scripts/builder-digest.mjs", "utf8");
  assert.match(cli, /validateTaskOutcome/);
  assert.match(cli, /skipped_requires_per_task_evidence/);
  assert.match(cli, /accountedOutcomes/);
  assert.match(cli, /plannedTask/);

  // Fetch-log carries per-task skip evidence.
  const fetchRunsRoute = readFileSync("src/app/api/skill/fetch-runs/[id]/route.ts", "utf8");
  assert.match(fetchRunsRoute, /evidence/);
  assert.match(fetchRunsRoute, /plannedTask/);

  // Fetch-log UI renders skipped + evidence and treats skip as a clean terminal.
  const panel = readFileSync("src/components/FetchLogPanel.tsx", "utf8");
  assert.match(panel, /Skipped — no content/);
  assert.match(panel, /formatEvidence/);

  // Contract forbids cross-task generalization / blanket skips.
  const contract = readFileSync(
    "skills/builder-blog-digest/jobs/_fetch-task-contract.md",
    "utf8",
  );
  assert.match(contract, /NEVER infer one task's content/);
  assert.match(contract, /per-task evidence/);
  assert.match(contract, /taskOutcomes/);

  // YouTube extraction strategy moved out of the contract into the source prompt.
  assert.doesNotMatch(contract, /silent screen recording/);
  assert.equal(
    existsSync("scripts/seed-youtube-fetch-prompt.mts"),
    false,
    "prompt updates should flow through Settings/migrations, not a reusable seed script",
  );
});

test("server content-quality floor rejects empty / too-short crawls", () => {
  // No content → missing.
  assert.deepEqual(checkBodyContentQuality(""), { ok: false, reason: "content_missing" });
  assert.deepEqual(checkBodyContentQuality("   \n\t "), {
    ok: false,
    reason: "content_missing",
  });
  // Below the source floor → too short.
  assert.deepEqual(
    checkBodyContentQuality("short", { minChars: 200, minContentUnits: 35 }),
    { ok: false, reason: "content_too_short" },
  );
  // Real content meeting the floor → ok.
  const realBody = "word ".repeat(40) + "x".repeat(200);
  assert.deepEqual(checkBodyContentQuality(realBody, { minChars: 200, minContentUnits: 35 }), {
    ok: true,
  });
  // No standards → 1/1 floor: any non-whitespace text passes (never stricter
  // than an unconfigured source).
  assert.deepEqual(checkBodyContentQuality("hi"), { ok: true });
  // CJK content counts toward chars/content units.
  assert.deepEqual(
    checkBodyContentQuality("你好世界这是测试", { minChars: 4, minContentUnits: 8 }),
    { ok: true },
  );
  assert.deepEqual(
    checkBodyContentQuality("你好世界这是测试", { minChars: 4, minContentUnits: 9 }),
    { ok: false, reason: "content_too_short" },
  );
  // Legacy minWords remains accepted for already-materialized user configs.
  assert.deepEqual(
    checkBodyContentQuality("你好世界这是测试", { minChars: 4, minWords: 8 }),
    { ok: true },
  );
});

test("digest feed user path selects not-yet-digested posts within the configured lookback", () => {
  const now = new Date("2026-05-23T12:00:00.000Z");
  // Lookback set → a publishedAt floor; 45 days before now = 2026-04-08.
  const withFloor = {
    digestMaxPostAgeDays: 45,
  };
  assert.equal(digestMaxPostAgeDays(withFloor), 45);
  const cutoff = digestMaxAgeCutoff(now, withFloor);
  assert.equal(cutoff?.toISOString(), "2026-04-08T12:00:00.000Z");

  // Lookback null/absent → the 30-day default; user choices are capped at 90.
  const defaultWindow = { digestMaxPostAgeDays: null };
  assert.equal(digestMaxPostAgeDays(defaultWindow), 30);
  assert.equal(digestMaxAgeCutoff(now, defaultWindow)?.toISOString(), "2026-04-23T12:00:00.000Z");
  assert.equal(digestMaxPostAgeDays({ digestMaxPostAgeDays: 90 }), 90);
  assert.equal(digestMaxPostAgeDays({ digestMaxPostAgeDays: 365 }), 30);
  assert.equal(digestMaxPostAgeDays({ digestMaxPostAgeDays: 0 }), 30);
  assert.equal(digestCandidateLimitForLastRun(now, null), 20);
  assert.equal(digestCandidateLimitForLastRun(now, "2026-05-23T11:59:59.000Z"), 20);
  assert.equal(digestCandidateLimitForLastRun(now, "2026-05-21T23:59:59.000Z"), 40);
  assert.equal(digestCandidateLimitForLastRun(now, "2026-05-10T12:00:00.000Z"), 100);

  // Candidate selection is gated by the per-user DigestedItem marker, not a
  // time window. Override (regenerate) re-includes already-digested posts.
  const contextRoute = readFileSync("src/app/api/skill/context/route.ts", "utf8");
  assert.match(contextRoute, /publishedAfter: lookbackCutoff/);
  assert.match(contextRoute, /digestCandidateLimitForLastRun\(now, lastDigest\?\.createdAt\)/);
  assert.match(contextRoute, /limit: digestCandidateLimit/);
  assert.doesNotMatch(contextRoute, /limit: 80/);
  assert.match(contextRoute, /candidateLimit: digestCandidateLimit/);
  assert.match(contextRoute, /excludeDigestedForUserId: regenerate \? null : user\.id/);
  assert.doesNotMatch(contextRoute, /newly fetched items created after the last digest/);
  assert.match(contextRoute, /regenerate/);
  assert.doesNotMatch(contextRoute, /legacyPrompts/);
  assert.doesNotMatch(contextRoute, /prompts:/);
  assert.match(contextRoute, /preference\?\.summaryLanguage/);
  assert.match(contextRoute, /normalizeSummaryLanguagePreference\(preference\?\.summaryLanguage\)/);
  assert.match(contextRoute, /languageMode = isOriginalContentLanguagePreference\(summaryLanguage\) \? "source" : "fixed"/);
  assert.match(contextRoute, /languageInstruction/);
  assert.match(contextRoute, /language: summaryLanguage/);
  assert.doesNotMatch(contextRoute, /cfg\.summaryLanguage/);
  assert.doesNotMatch(contextRoute, /lengthHint: cfg\.summaryLengthHint/);

  // The exclusion is implemented in the shared deduped-feed helper.
  const resolver = readFileSync("src/lib/builder-channel-resolver.ts", "utf8");
  assert.match(resolver, /loadDigestedContentKeys/);
  assert.match(resolver, /excludeDigestedForUserId/);

  // Sync marks the presented candidate set as digested (per-user, idempotent).
  const digestCreateRoute = readFileSync("src/app/api/skill/digests/route.ts", "utf8");
  assert.match(digestCreateRoute, /digestedItem\.upsert/);
  assert.match(digestCreateRoute, /userId_entityId_kind_externalId/);

  // The CLI reads candidates from the prepared context file and sends them.
  const cli = readFileSync("scripts/builder-digest.mjs", "utf8");
  // Each caller declares its intent so the shared context endpoint does only its
  // own work: digest prepare records a DigestRun + computes candidates; library
  // fetch does neither.
  assert.match(cli, /api\/skill\/context\?intent=digest/);
  assert.doesNotMatch(cli, /includePrompts=1/);
  assert.match(cli, /api\/skill\/context\?intent=library&days=/);
  assert.match(cli, /digestedItems/);
  assert.match(cli, /builder-blog-context\.json/);
  assert.doesNotMatch(cli, /postSummaryTasksForBuilders\(builders,\s*context\.prompts\)/);
  assert.doesNotMatch(cli, /withSummaryInstructions\(task,\s*context\.prompts\)/);
});

test("digest candidate limit prioritizes one post from each source before filling by recency", () => {
  const ordered = [
    { entityId: "source-a", externalId: "a-new" },
    { entityId: "source-a", externalId: "a-mid" },
    { entityId: "source-b", externalId: "b-new" },
    { entityId: "source-a", externalId: "a-old" },
    { entityId: "source-c", externalId: "c-new" },
    { entityId: "source-b", externalId: "b-old" },
  ];

  assert.deepEqual(
    prioritizeSourceCoverage(ordered, 4).map((item) => item.externalId),
    ["a-new", "b-new", "c-new", "a-mid"],
  );
  assert.deepEqual(
    prioritizeSourceCoverage(ordered, 2).map((item) => item.externalId),
    ["a-new", "b-new"],
  );
});

test("recommendation feed user path scores unread fetched posts from profile, subscriptions, and read log", () => {
  const now = new Date("2026-05-23T12:00:00.000Z");
  const subscribedBuilder = {
    id: "builder_memory",
    entityId: "entity_memory",
    name: "Memory Labs",
    handle: null,
    kind: BuilderKind.BLOG,
    sourceType: "blog",
    sourceUrl: "https://example.com",
    fetchUrl: "https://example.com/blog",
    bio: "Agent memory and retrieval systems.",
    ownerUserId: null,
    lastFetchedAt: null,
  };
  const signals = buildRecommendationSignals({
    profileText: "I care about agent memory, retrieval, and product launches.",
    subscriptions: [subscribedBuilder],
    reads: [
      recommendationCandidate({
        id: "read_1",
        builder: subscribedBuilder,
        body: "Vector retrieval for durable agent memory.",
        publishedAt: "2026-05-21T12:00:00.000Z",
      }),
    ],
  });
  const relevant = scoreRecommendation({
    item: recommendationCandidate({
      id: "candidate_1",
      builder: subscribedBuilder,
      title: "Agent memory launch notes",
      body: "A retrieval architecture for long-running agents.",
      publishedAt: "2026-05-22T12:00:00.000Z",
    }),
    signals,
    now,
  });
  const unrelated = scoreRecommendation({
    item: recommendationCandidate({
      id: "candidate_2",
      builder: null,
      title: "Pricing update",
      body: "A billing change for a design tool.",
      publishedAt: "2026-04-01T12:00:00.000Z",
    }),
    signals,
    now,
  });

  assert.ok(relevant.score > unrelated.score);
  assert.ok(relevant.reasons.includes("from a subscribed builder"));
  assert.ok(relevant.reasons.includes("matches your profile and reading topics"));
});

test("digest generation user path exposes source-specific prompt instructions", () => {
  assert.deepEqual(
    Object.keys(DEFAULT_DIGEST_PROMPTS).sort(),
    [
      "digestIntro",
      "fetchGithubTrendingRepo",
      "fetchPodcastAudio",
      "fetchProductHuntTopProduct",
      "headline",
      "perSourceSummary",
      "summarizeBlogs",
      "summarizeGithubTrendingRepo",
      "summarizePodcast",
      "summarizeProductHuntTopProduct",
      "summarizeTweets",
      "translate",
    ].sort(),
  );
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizePodcast, /podcast transcript/i);
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizeTweets, /X\/Twitter Summary Prompt/);
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizeBlogs, /Blog Post Summary Prompt/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchGithubTrendingRepo, /README/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchGithubTrendingRepo, /web search/i);
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizeGithubTrendingRepo, /user-selected output language/);
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizeGithubTrendingRepo, /Project name:/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.summarizeGithubTrendingRepo, /Chinese|项目名称/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /Product Hunt product page/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /substantive user comments/);
  assert.match(
    DEFAULT_DIGEST_PROMPTS.summarizeProductHuntTopProduct,
    /user-selected output language/,
  );
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizeProductHuntTopProduct, /Product name:/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.summarizeProductHuntTopProduct, /Chinese|项目名称/);
  assert.match(DEFAULT_DIGEST_PROMPTS.digestIntro, /Legacy Digest Intro Prompt/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /headlineSummary/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /context\.language/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /one line per source/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /Source name: one sentence summary/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /50 characters or fewer/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.headline, /Chinese characters|Mandarin|simplified Chinese/i);
  assert.match(DEFAULT_DIGEST_PROMPTS.perSourceSummary, /exactly one source/);
  assert.match(DEFAULT_DIGEST_PROMPTS.perSourceSummary, /output an empty string/);
  assert.match(DEFAULT_DIGEST_PROMPTS.perSourceSummary, /context\.language/);
  // Translate step is language-agnostic and only rewrites existing per-post
  // summaries; headline/source summaries use their own prompts.
  assert.match(DEFAULT_DIGEST_PROMPTS.translate, /target language given by context\.language/);
  assert.match(DEFAULT_DIGEST_PROMPTS.translate, /per-post summary/);
  assert.match(DEFAULT_DIGEST_PROMPTS.translate, /Do not write headlineSummary/);
  assert.match(DEFAULT_DIGEST_PROMPTS.translate, /Do not write source-level summaries/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.translate, /simplified Chinese|Mandarin/i);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchPodcastAudio, /Podcast Fetch Prompt/);
});

test("search user path exact mode matches literal text across builders, feeds, and digests", () => {
  const results = rankSearchDocuments({
    query: "agent memory",
    mode: "exact",
    documents: [
      {
        id: "builder_1",
        type: "builder",
        title: "Memory Labs",
        body: "Builder working on agent memory systems.",
      },
      {
        id: "feed_1",
        type: "feed",
        title: "Launch notes",
        body: "A retrieval workflow without the literal phrase.",
      },
      {
        id: "digest_1",
        type: "digest",
        title: "Daily Digest",
        body: "Today covered AGENT MEMORY and terminal workflows.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["digest_1", "builder_1"]);
  assert.equal(results[0].type, "digest");
  assert.match(results[0].snippet, /AGENT MEMORY/);
});

test("search user path includes imported digest pipeline digests", () => {
  const userSearch = readFileSync("src/lib/user-search.ts", "utf8");

  assert.match(userSearch, /digestPipelineImport\.findMany/);
  assert.match(userSearch, /pipeline:\s*\{/);
  assert.match(userSearch, /isPublic:\s*true/);
  assert.match(userSearch, /importedDigestPipelines/);
  assert.match(userSearch, /digestOwnerToPipeline/);
  assert.match(userSearch, /userId:\s*\{\s*in:\s*digestOwnerIds\s*\}/);
  assert.match(userSearch, /pipeline=\$\{pipeline\.id\}#\$\{digest\.id\}/);
  assert.match(userSearch, /owner:\s*\{\s*select:\s*\{\s*name:\s*true,\s*email:\s*true\s*\}\s*\}/);
  assert.match(userSearch, /displayDigestPipelineTitleForOwner\(/);
});

test("search user path supports wildcard terms inside quoted phrases", () => {
  const parsed = parseSearchQuery('"agent * memory"');

  assert.equal(parsed.cleanQuery, "agent * memory");
  assert.deepEqual(parsed.phrases, ["agent * memory"]);

  const results = rankSearchDocuments({
    query: '"agent * memory"',
    mode: "exact",
    documents: [
      {
        id: "one-gap",
        type: "feed",
        title: "Launch notes",
        body: "The team shipped agent workflow memory.",
      },
      {
        id: "no-gap",
        type: "feed",
        title: "Agent memory",
        body: "The exact phrase has no wildcard term.",
      },
      {
        id: "two-gap",
        type: "feed",
        title: "Launch notes",
        body: "The team shipped agent workflow durable memory.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["one-gap"]);
});

test("search user path semantic mode finds related language without a literal phrase", () => {
  const results = rankSearchDocuments({
    query: "embedding search",
    mode: "semantic",
    documents: [
      {
        id: "feed_1",
        type: "feed",
        title: "Archive retrieval",
        body: "Vector recall over fetched posts and saved digest history.",
      },
      {
        id: "builder_1",
        type: "builder",
        title: "Unrelated Builder",
        body: "A frontend design feed with launch screenshots.",
      },
      {
        id: "digest_1",
        type: "digest",
        title: "Semantic lookup",
        body: "The digest explains vector search for personal knowledge bases.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["digest_1", "feed_1"]);
  assert.ok(results[0].score > results[1].score);
});

test("search user path normalizes modes and ignores empty queries", () => {
  assert.equal(normalizeSearchMode("exact"), "exact");
  assert.equal(normalizeSearchMode("bad"), "hybrid");
  assert.deepEqual(
    rankSearchDocuments({
      query: "   ",
      mode: "hybrid",
      documents: [
        { id: "builder_1", type: "builder", title: "OpenAI", body: "AI builder" },
      ],
    }),
    [],
  );
});

test("hybrid search blends literal and semantic matching", () => {
  const results = rankSearchDocuments({
    query: "agent memory",
    mode: "hybrid",
    documents: [
      {
        id: "literal",
        type: "feed",
        title: "Agent memory systems",
        body: "A launch note with the exact phrase.",
      },
      {
        id: "related",
        type: "digest",
        title: "Retrieval workflow",
        body: "Assistant recall patterns for saved library history.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["literal", "related"]);
});

test("hybrid search reserves top four slots for exact and semantic leaders", () => {
  const results = rankSearchDocuments({
    query: "agent memory",
    mode: "hybrid",
    documents: [
      {
        id: "exact-1",
        type: "feed",
        title: "Agent memory",
        body: "A literal title match.",
      },
      {
        id: "exact-2",
        type: "feed",
        title: "Agent memory roadmap",
        body: "Another literal title match.",
      },
      {
        id: "semantic-1",
        type: "feed",
        title: "AI assistant workflow",
        body: "Recall systems for agents.",
      },
      {
        id: "semantic-2",
        type: "feed",
        title: "Assistant workflow",
        body: "AI agent recall and saved library context.",
      },
      {
        id: "hybrid-strong",
        type: "feed",
        title: "Agent workflow",
        body: "Agent memory assistant recall workflow.",
      },
      {
        id: "body-literal",
        type: "feed",
        title: "Launch note",
        body: "Agent memory appears in the body.",
      },
    ],
  });

  const topFour = results.slice(0, 4).map((result) => result.id);

  assert.equal(topFour.includes("exact-1"), true);
  assert.equal(topFour.includes("exact-2"), true);
  assert.equal(topFour.includes("hybrid-strong"), true);
  assert.equal(topFour.includes("semantic-1"), true);
  assert.equal(topFour.includes("body-literal"), false);
  assert.deepEqual(
    results.slice(0, 4).map((result) => result.score),
    results
      .slice(0, 4)
      .map((result) => result.score)
      .toSorted((a, b) => b - a),
  );
});

test("hybrid search uses expanded database recall terms by default", () => {
  assert.deepEqual(candidateSearchTerms("agent memory", "exact"), ["agent memory"]);

  const semanticTerms = candidateSearchTerms("embedding search", "hybrid");

  assert.ok(semanticTerms.includes("embedding"));
  assert.ok(semanticTerms.includes("search"));
  assert.ok(semanticTerms.includes("vector"));
  assert.ok(semanticTerms.includes("retrieval"));
  assert.equal(new Set(semanticTerms).size, semanticTerms.length);
  assert.ok(semanticTerms.length <= 12);
});

test("search user path offers related search rewrites from semantic terms", () => {
  const suggestions = relatedSearchSuggestions("agent memory");

  assert.ok(suggestions.includes("ai memory"));
  assert.ok(suggestions.includes("assistant memory"));
  assert.ok(suggestions.includes("workflow memory"));
  assert.equal(new Set(suggestions).size, suggestions.length);
  assert.ok(suggestions.length <= 6);
});

test("search user path parses google-style operators", () => {
  const parsed = parseSearchQuery('"agent memory" site:example.com intitle:launch inurl:release agent OR embedding type:feed -pricing after:2026-01-01 before:2026-02-01');

  assert.equal(parsed.cleanQuery, "agent memory launch release agent embedding");
  assert.deepEqual(parsed.phrases, ["agent memory"]);
  assert.deepEqual(parsed.excludedTerms, ["pricing"]);
  assert.deepEqual(parsed.orTerms, ["agent", "embedding"]);
  assert.deepEqual(parsed.titleTerms, ["launch"]);
  assert.deepEqual(parsed.urlTerms, ["release"]);
  assert.equal(parsed.site, "example.com");
  assert.equal(parsed.type, "feed");
  assert.equal(parsed.after?.toISOString().slice(0, 10), "2026-01-01");
  assert.equal(parsed.before?.toISOString().slice(0, 10), "2026-02-01");
});

test("search result highlighting ignores operators and excluded terms", () => {
  const terms = searchHighlightTerms(
    'agent -intitle:pricing site:example.com allintext:memory launch -"sponsored segment"',
  );

  assert.deepEqual(terms, ["memory", "launch", "agent"]);
});

test("search result refinement builds source-limited queries", () => {
  assert.equal(
    searchSiteFromUrl("https://www.example.com/articles/agent-memory?ref=builder"),
    "example.com",
  );
  assert.equal(searchSiteFromUrl("/history#digest_1"), null);
  assert.equal(
    withSiteSearchOperator("agent memory site:old.example.com -site:spam.example.com", "example.com"),
    "agent memory -site:spam.example.com site:example.com",
  );
});

test("source search results keep detail links while matching external URLs", () => {
  const results = rankSearchDocuments({
    query: "site:claude.com claude",
    mode: "exact",
    documents: [
      {
        id: "builder_claude",
        type: "builder",
        title: "claude.com",
        body: "Claude blog source for Anthropic product updates.",
        url: "/builder/entity_claude",
        externalUrl: "https://claude.com/blog",
        sourceName: "Blog",
      },
      {
        id: "builder_other",
        type: "builder",
        title: "other.example",
        body: "Other blog source for Anthropic product updates.",
        url: "/builder/entity_other",
        externalUrl: "https://other.example/blog",
        sourceName: "Blog",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["builder_claude"]);
  assert.equal(results[0].url, "/builder/entity_claude");
  assert.equal(results[0].externalUrl, "https://claude.com/blog");
});

test("search tool clearing removes whole all-in operator groups", () => {
  assert.equal(
    stripSearchQueryOperators("allintitle:agent memory site:example.com", [
      "title",
      "intitle",
      "allintitle",
    ]),
    "site:example.com",
  );
  assert.equal(
    stripSearchQueryOperators("agent allintext:retrieval quality after:2026-01-01", [
      "text",
      "intext",
      "allintext",
    ]),
    "agent after:2026-01-01",
  );
  assert.equal(
    stripNegativeSearchQueryOperators("agent -allintitle:pricing launch site:example.com", [
      "title",
      "intitle",
      "allintitle",
    ]),
    "agent site:example.com",
  );
});

test("search user path parses filetype as a google-style type operator", () => {
  const parsed = parseSearchQuery("agent memory filetype:digests");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.equal(parsed.type, "digest");
  assert.equal(parsed.typeOperator, "filetype");
});

test("search type operators accept the same source and post words shown in the UI", () => {
  assert.equal(parseSearchQuery("agent memory type:source").type, "builder");
  assert.equal(parseSearchQuery("agent memory type:posts").type, "feed");
  assert.equal(parseSearchQuery("agent memory filetype:ai-digest").type, "digest");
  assert.deepEqual(parseSearchQuery("agent memory -type:sources").excludedTypes, ["builder"]);
});

test("search user path applies operator filters and newest sorting", () => {
  const oldDate = new Date("2026-01-10T00:00:00.000Z");
  const newDate = new Date("2026-01-20T00:00:00.000Z");
  const results = rankSearchDocuments({
    query: 'agent memory site:example.com -pricing after:2026-01-15 type:feed',
    mode: "hybrid",
    sort: "newest",
    documents: [
      {
        id: "old",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory without excluded language.",
        url: "https://example.com/old",
        date: oldDate,
      },
      {
        id: "excluded",
        type: "feed",
        title: "Agent memory pricing",
        body: "Agent memory pricing details.",
        url: "https://example.com/pricing",
        date: newDate,
      },
      {
        id: "wrong-site",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://other.example/memory",
        date: newDate,
      },
      {
        id: "kept",
        type: "feed",
        title: "Agent memory release",
        body: "Agent memory note.",
        url: "https://example.com/new",
        date: newDate,
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept"]);
});

test("search user path excludes sites with negative site operator", () => {
  const parsed = parseSearchQuery("agent memory -site:example.com");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.excludedSites, ["example.com"]);
  assert.deepEqual(parsed.excludedTerms, []);

  const results = rankSearchDocuments({
    query: "agent memory -site:example.com",
    mode: "hybrid",
    documents: [
      {
        id: "excluded-root",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/posts/agent-memory",
      },
      {
        id: "excluded-subdomain",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://blog.example.com/posts/agent-memory",
      },
      {
        id: "kept",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://other.example/posts/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept"]);
});

test("search user path supports site operators with URL paths", () => {
  const parsed = parseSearchQuery("agent memory site:example.com/articles");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.equal(parsed.site, "example.com/articles");

  const results = rankSearchDocuments({
    query: "agent memory site:example.com/articles",
    mode: "hybrid",
    documents: [
      {
        id: "article",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/articles/agent-memory",
      },
      {
        id: "root",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/agent-memory",
      },
      {
        id: "other-path",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/posts/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["article"]);
});

test("search user path excludes site operator paths without excluding the whole host", () => {
  const parsed = parseSearchQuery("agent memory -site:example.com/articles");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.excludedSites, ["example.com/articles"]);

  const results = rankSearchDocuments({
    query: "agent memory -site:example.com/articles",
    mode: "hybrid",
    documents: [
      {
        id: "excluded-path",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/articles/agent-memory",
      },
      {
        id: "kept-host",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory note.",
        url: "https://example.com/posts/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept-host"]);
});

test("search user path supports operator-only result sets", () => {
  const results = rankSearchDocuments({
    query: "site:example.com",
    mode: "hybrid",
    documents: [
      {
        id: "source",
        type: "feed",
        title: "Agent memory launch",
        body: "A launch note from the source site.",
        url: "https://example.com/agent-memory",
      },
      {
        id: "other",
        type: "feed",
        title: "Agent memory launch",
        body: "A launch note from a different site.",
        url: "https://other.test/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["source"]);
});

test("search user path excludes quoted phrases with negative phrase operator", () => {
  const parsed = parseSearchQuery('agent -"memory leak"');

  assert.equal(parsed.cleanQuery, "agent");
  assert.deepEqual(parsed.phrases, []);
  assert.deepEqual(parsed.excludedPhrases, ["memory leak"]);
  assert.deepEqual(parsed.excludedTerms, []);

  const results = rankSearchDocuments({
    query: 'agent -"memory leak"',
    mode: "exact",
    documents: [
      {
        id: "excluded",
        type: "feed",
        title: "Agent incident",
        body: "The memory leak affected the launch agent.",
        url: "https://example.com/incidents/memory-leak",
      },
      {
        id: "kept",
        type: "feed",
        title: "Agent memory guide",
        body: "Memory tuning avoids leak reports in the release notes.",
        url: "https://example.com/guides/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept"]);
});

test("search user path filters by filetype operator", () => {
  const results = rankSearchDocuments({
    query: "agent memory filetype:digest",
    mode: "hybrid",
    documents: [
      {
        id: "digest-match",
        type: "digest",
        title: "Agent memory",
        body: "Agent memory digest.",
      },
      {
        id: "feed-match",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory feed item.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["digest-match"]);
});

test("search user path excludes filetypes with negative type operators", () => {
  const parsed = parseSearchQuery("agent memory -filetype:digest -type:builder");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.excludedTypes, ["digest", "builder"]);
  assert.deepEqual(parsed.excludedTerms, []);

  const results = rankSearchDocuments({
    query: "agent memory -filetype:digest -type:builder",
    mode: "hybrid",
    documents: [
      {
        id: "digest-match",
        type: "digest",
        title: "Agent memory",
        body: "Agent memory digest.",
      },
      {
        id: "builder-match",
        type: "builder",
        title: "Agent memory",
        body: "Agent memory builder.",
      },
      {
        id: "feed-match",
        type: "feed",
        title: "Agent memory",
        body: "Agent memory feed item.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["feed-match"]);
});

test("search user path filters by title operator", () => {
  const results = rankSearchDocuments({
    query: "agent memory intitle:launch",
    mode: "hybrid",
    documents: [
      {
        id: "title-match",
        type: "feed",
        title: "Agent memory launch notes",
        body: "A short release writeup.",
      },
      {
        id: "body-only",
        type: "feed",
        title: "Agent memory notes",
        body: "Launch details in the body should not satisfy intitle.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["title-match"]);
});

test("search user path excludes scoped title text and URL operators", () => {
  const parsed = parseSearchQuery("agent -intitle:pricing -intext:sponsored -inurl:archive");

  assert.equal(parsed.cleanQuery, "agent");
  assert.deepEqual(parsed.excludedTitleTerms, ["pricing"]);
  assert.deepEqual(parsed.excludedBodyTerms, ["sponsored"]);
  assert.deepEqual(parsed.excludedUrlTerms, ["archive"]);
  assert.deepEqual(parsed.excludedTerms, []);

  const results = rankSearchDocuments({
    query: "agent -intitle:pricing -intext:sponsored -inurl:archive",
    mode: "hybrid",
    documents: [
      {
        id: "title-excluded",
        type: "feed",
        title: "Agent pricing notes",
        body: "A launch writeup.",
        url: "https://example.com/releases/agent",
      },
      {
        id: "body-excluded",
        type: "feed",
        title: "Agent launch notes",
        body: "Sponsored coverage of the agent launch.",
        url: "https://example.com/releases/agent",
      },
      {
        id: "url-excluded",
        type: "feed",
        title: "Agent launch notes",
        body: "A launch writeup.",
        url: "https://example.com/archive/agent",
      },
      {
        id: "kept",
        type: "feed",
        title: "Agent launch notes",
        body: "A launch writeup.",
        url: "https://example.com/releases/agent",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept"]);
});

test("search user path supports allintitle operator", () => {
  const parsed = parseSearchQuery("allintitle:agent memory site:example.com");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.titleTerms, ["agent", "memory"]);
  assert.equal(parsed.site, "example.com");

  const results = rankSearchDocuments({
    query: "allintitle:agent memory",
    mode: "exact",
    documents: [
      {
        id: "title-match",
        type: "feed",
        title: "Agent memory launch",
        body: "A short note.",
      },
      {
        id: "split-match",
        type: "feed",
        title: "Agent launch",
        body: "Memory appears only in the body.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["title-match"]);
});

test("search user path excludes all-in scoped title text and URL operators", () => {
  const parsed = parseSearchQuery(
    "agent -allintitle:pricing launch -allintext:sponsored transcript -allinurl:archive agent",
  );

  assert.equal(parsed.cleanQuery, "agent");
  assert.deepEqual(parsed.excludedTitleTerms, []);
  assert.deepEqual(parsed.excludedBodyTerms, []);
  assert.deepEqual(parsed.excludedUrlTerms, []);
  assert.deepEqual(parsed.excludedAllTitleTermGroups, [["pricing", "launch"]]);
  assert.deepEqual(parsed.excludedAllBodyTermGroups, [["sponsored", "transcript"]]);
  assert.deepEqual(parsed.excludedAllUrlTermGroups, [["archive", "agent"]]);
  assert.deepEqual(parsed.excludedTerms, []);

  const results = rankSearchDocuments({
    query: "agent -allintitle:pricing launch -allintext:sponsored transcript -allinurl:archive agent",
    mode: "hybrid",
    documents: [
      {
        id: "title-excluded",
        type: "feed",
        title: "Agent launch pricing",
        body: "A release note.",
        url: "https://example.com/releases/agent",
      },
      {
        id: "body-excluded",
        type: "feed",
        title: "Agent launch",
        body: "Sponsored transcript from the demo.",
        url: "https://example.com/releases/agent",
      },
      {
        id: "url-excluded",
        type: "feed",
        title: "Agent launch",
        body: "A release note.",
        url: "https://example.com/archive/agent",
      },
      {
        id: "kept",
        type: "feed",
        title: "Agent launch",
        body: "A release note.",
        url: "https://example.com/releases/workflow",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["kept"]);
});

test("search user path filters by text operator", () => {
  const results = rankSearchDocuments({
    query: "agent memory intext:transcript",
    mode: "hybrid",
    documents: [
      {
        id: "body-match",
        type: "feed",
        title: "Agent memory notes",
        body: "Transcript details from the builder session.",
      },
      {
        id: "title-only",
        type: "feed",
        title: "Agent memory transcript",
        body: "A short note.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["body-match"]);
});

test("search user path supports allintext operator", () => {
  const parsed = parseSearchQuery("allintext:agent memory site:example.com");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.bodyTerms, ["agent", "memory"]);
  assert.equal(parsed.site, "example.com");

  const results = rankSearchDocuments({
    query: "allintext:agent memory",
    mode: "exact",
    documents: [
      {
        id: "body-match",
        type: "feed",
        title: "Session notes",
        body: "Agent memory launch details.",
      },
      {
        id: "title-match",
        type: "feed",
        title: "Agent memory launch",
        body: "A short note.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["body-match"]);
});

test("search user path filters by URL operator", () => {
  const results = rankSearchDocuments({
    query: "agent memory inurl:release",
    mode: "hybrid",
    documents: [
      {
        id: "url-match",
        type: "feed",
        title: "Agent memory launch",
        body: "A short writeup.",
        url: "https://example.com/releases/agent-memory",
      },
      {
        id: "body-only",
        type: "feed",
        title: "Agent memory notes",
        body: "Release details in the body should not satisfy inurl.",
        url: "https://example.com/notes/agent-memory",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["url-match"]);
});

test("search user path supports allinurl operator", () => {
  const parsed = parseSearchQuery("allinurl:release agent type:feed");

  assert.equal(parsed.cleanQuery, "release agent");
  assert.deepEqual(parsed.urlTerms, ["release", "agent"]);
  assert.equal(parsed.type, "feed");

  const results = rankSearchDocuments({
    query: "allinurl:release agent",
    mode: "hybrid",
    documents: [
      {
        id: "url-match",
        type: "feed",
        title: "Release agent",
        body: "A short writeup.",
        url: "https://example.com/releases/agent",
      },
      {
        id: "split-match",
        type: "feed",
        title: "Release agent",
        body: "A short writeup.",
        url: "https://example.com/releases/workflow",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["url-match"]);
});

test("search user path supports explicit OR alternatives in exact mode", () => {
  assert.deepEqual(candidateSearchTerms("agent OR embedding", "exact"), ["agent", "embedding"]);

  const results = rankSearchDocuments({
    query: "agent OR embedding",
    mode: "exact",
    documents: [
      {
        id: "agent",
        type: "feed",
        title: "Agent launch",
        body: "A short note.",
      },
      {
        id: "embedding",
        type: "feed",
        title: "Vector release",
        body: "Embedding search details.",
      },
      {
        id: "miss",
        type: "feed",
        title: "Digest archive",
        body: "A short note.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["agent", "embedding"]);
});

test("search user path supports quoted phrase OR alternatives", () => {
  const parsed = parseSearchQuery('"agent memory" OR "retrieval quality"');

  assert.equal(parsed.cleanQuery, "agent memory retrieval quality");
  assert.deepEqual(parsed.phrases, []);
  assert.deepEqual(parsed.orPhrases, ["agent memory", "retrieval quality"]);
  assert.deepEqual(parsed.orTerms, []);
  assert.deepEqual(candidateSearchTerms('"agent memory" OR "retrieval quality"', "exact"), [
    "agent memory",
    "retrieval quality",
  ]);

  const results = rankSearchDocuments({
    query: '"agent memory" OR "retrieval quality"',
    mode: "exact",
    documents: [
      {
        id: "agent-memory",
        type: "feed",
        title: "Launch note",
        body: "The article explains agent memory for long-running work.",
      },
      {
        id: "retrieval-quality",
        type: "feed",
        title: "Evaluation note",
        body: "The article explains retrieval quality for search systems.",
      },
      {
        id: "split-token",
        type: "feed",
        title: "Partial note",
        body: "The article says memory and retrieval but never either requested phrase.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), [
    "retrieval-quality",
    "agent-memory",
  ]);
  assert.match(results[0].snippet, /retrieval quality/i);
});

test("search user path supports parenthesized quoted OR groups", () => {
  const parsed = parseSearchQuery('("agent memory" OR "retrieval quality") launch');

  assert.equal(parsed.cleanQuery, "agent memory retrieval quality launch");
  assert.deepEqual(parsed.phrases, []);
  assert.deepEqual(parsed.orPhrases, ["agent memory", "retrieval quality"]);
  assert.deepEqual(parsed.requiredTerms, [
    "agent",
    "memory",
    "retrieval",
    "quality",
    "launch",
  ]);
  assert.deepEqual(
    candidateSearchTerms('("agent memory" OR "retrieval quality") launch', "exact"),
    ["agent memory", "retrieval quality"],
  );

  const results = rankSearchDocuments({
    query: '("agent memory" OR "retrieval quality") launch',
    mode: "exact",
    documents: [
      {
        id: "agent-launch",
        type: "feed",
        title: "Launch note",
        body: "The launch article explains agent memory for long-running work.",
      },
      {
        id: "retrieval-launch",
        type: "feed",
        title: "Launch note",
        body: "The launch article explains retrieval quality for search systems.",
      },
      {
        id: "no-launch",
        type: "feed",
        title: "Old note",
        body: "The article explains agent memory but does not mention the required topic.",
      },
      {
        id: "split-launch",
        type: "feed",
        title: "Launch note",
        body: "The launch article says memory and retrieval but neither requested phrase.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), [
    "agent-launch",
    "retrieval-launch",
  ]);
});

test("search user path supports AROUND proximity operator in exact mode", () => {
  const parsed = parseSearchQuery("agent AROUND(2) memory");

  assert.equal(parsed.cleanQuery, "agent memory");
  assert.deepEqual(parsed.proximityPairs, [{ left: "agent", right: "memory", distance: 2 }]);

  const results = rankSearchDocuments({
    query: "agent AROUND(2) memory",
    mode: "exact",
    documents: [
      {
        id: "close",
        type: "feed",
        title: "Agent workflow memory",
        body: "A short note.",
      },
      {
        id: "far",
        type: "feed",
        title: "Agent teams capture logs traces and memory",
        body: "A short note.",
      },
      {
        id: "missing",
        type: "feed",
        title: "Agent workflow",
        body: "A short note.",
      },
    ],
  });

  assert.deepEqual(results.map((result) => result.id), ["close"]);
});

test("search user path suggests simple spelling corrections and normalizes tools", () => {
  assert.equal(didYouMeanSearch("agnet memroy serach"), "agent memory search");
  assert.equal(normalizeSearchSort("newest"), "newest");
  assert.equal(normalizeSearchSort("bad"), "relevance");
  assert.equal(normalizeSearchTime("week"), "week");
  assert.equal(normalizeSearchTime("bad"), "any");
});

test("search user path merges autocomplete predictions before matching history", () => {
  const suggestions = mergeSearchSuggestions({
    query: "agent",
    recentSearches: ["agent memory", "digest archive"],
    liveSuggestions: ["Agent Memory", "agent workflows", "builder launch"],
    serverSuggestions: ["agent memory", "assistant memory", "agent"],
    limit: 5,
  });

  assert.deepEqual(suggestions, [
    "Agent Memory",
    "agent workflows",
    "builder launch",
    "assistant memory",
  ]);
});

test("search suggestions prioritize current query predictions over unrelated history", () => {
  const suggestions = mergeSearchSuggestions({
    query: "claude",
    recentSearches: ["Transformer", "Ter", "Sam", "Andrew", '"agent memory"'],
    liveSuggestions: ["claude code", "claude ai", "anthropic releases"],
    serverSuggestions: ["claude docs"],
    limit: 5,
  });

  assert.deepEqual(suggestions, [
    "claude code",
    "claude ai",
    "anthropic releases",
    "claude docs",
  ]);
});

test("search user path normalizes persisted recent searches", () => {
  assert.deepEqual(
    normalizeRecentSearches([
      " agent memory ",
      "",
      "Agent Memory",
      "digest archive",
      "builder launch",
      "semantic search",
      "podcast transcript",
      "extra query",
      42,
      null,
    ]),
    [
      "agent memory",
      "digest archive",
      "builder launch",
      "semantic search",
      "podcast transcript",
    ],
  );
  assert.deepEqual(normalizeRecentSearches("not an array"), []);
});

test("search user path only auto-searches corrected spellings when the original has no results", () => {
  assert.equal(
    shouldUseCorrectedSearch({
      correctedQuery: "agent memory search",
      originalResultCount: 0,
    }),
    true,
  );
  assert.equal(
    shouldUseCorrectedSearch({
      correctedQuery: "agent memory search",
      originalResultCount: 1,
    }),
    false,
  );
  assert.equal(
    shouldUseCorrectedSearch({
      correctedQuery: null,
      originalResultCount: 0,
    }),
    false,
  );
});

test("web display boundaries keep raw fetched content in the builders tab", () => {
  const dashboardPage = readFileSync("src/app/(workspace)/dashboard/page.tsx", "utf8");
  const buildersPage = readFileSync("src/app/(workspace)/builders/page.tsx", "utf8");
  const builderLibraryList = readFileSync("src/components/BuilderLibraryList.tsx", "utf8");
  const builderFeedItems = readFileSync("src/components/BuilderFeedItems.tsx", "utf8");

  assert.equal(dashboardPage.includes("prisma.feedItem.findMany"), false);
  assert.equal(dashboardPage.includes("Latest digest inputs"), false);
  assert.equal(buildersPage.includes("prisma.feedItem.findMany"), false);
  assert.equal(buildersPage.includes("Recent fetched content"), false);
  assert.equal(buildersPage.includes("BuilderLibraryList"), true);
  assert.equal(builderLibraryList.includes("BuilderFeedItems"), true);
  assert.equal(buildersPage.includes("Technical details"), false);
  assert.equal(builderLibraryList.includes("SourceBadge"), true);
  // UI copy stays away from "fetched" inside the library row; the canonical
  // display component is PostCard, while fetched-post-* classes still use
  // "fetched" because the storage layer is still the FeedItem fetch path.
  assert.equal(builderFeedItems.includes('className="builder-posts-count"'), true);
  assert.equal(builderFeedItems.includes("{visibleCount} posts"), true);
  assert.equal(builderFeedItems.includes("formatPostDate"), true);
  assert.equal(builderFeedItems.includes("PostCard"), true);
  assert.equal(builderFeedItems.includes("showSourceBadge={false}"), true);
  assert.equal(readFileSync("src/components/PostCard.tsx", "utf8").includes("Raw content"), true);
});

test("source registry centralizes current source categories", () => {
  assert.equal(feedItemKindLabel(FeedItemKind.PODCAST_EPISODE), "Podcast episode");
  assert.equal(
    sourceDefinitionForBuilder({
      kind: BuilderKind.PODCAST,
      sourceType: "youtube",
      sourceUrl: "https://www.youtube.com/@OpenAI",
      fetchUrl: null,
    })?.id,
    "youtube",
  );
  assert.equal(
    sourceDefinitionForBuilder({
      kind: BuilderKind.PODCAST,
      sourceUrl: "https://www.youtube.com/@OpenAI",
      fetchUrl: null,
    })?.id,
    "youtube",
  );
  assert.equal(
    sourceDefinitionForBuilder({
      kind: BuilderKind.PODCAST,
      sourceType: "youtube",
      sourceUrl: "https://video.example.com/openai",
      fetchUrl: null,
    })?.id,
    "youtube",
  );
  assert.equal(
    sourceDefinitionForBuilder({
      kind: BuilderKind.PODCAST,
      sourceUrl: "https://feeds.example.com/show.xml",
      fetchUrl: null,
    })?.id,
    "podcast",
  );
  assert.equal(
    sourceDefinitionForBuilder({
      kind: BuilderKind.X,
      sourceUrl: "https://x.com/example",
      fetchUrl: null,
    })?.id,
    "x",
  );
  assert.equal(
    sourceDefinitionForBuilder({
      kind: BuilderKind.WEBSITE,
      sourceType: "website",
      sourceUrl: "https://example.com",
      fetchUrl: null,
    })?.id,
    "website",
  );
  assert.equal(
    sourceDefinitionForBuilder({
      kind: BuilderKind.WEBSITE,
      sourceType: "github_trending",
      sourceUrl: "https://github.com/trending?since=daily",
      fetchUrl: "https://github.com/trending?since=daily",
    })?.staticLabel,
    "GitHub Trending",
  );
  assert.equal(builderKindForSourceType("github_trending"), BuilderKind.WEBSITE);
  assert.equal(
    sourceDefinitionForBuilder({
      kind: BuilderKind.WEBSITE,
      sourceType: "product_hunt_top_products",
      sourceUrl: "https://www.producthunt.com/",
      fetchUrl: "https://www.producthunt.com/",
    })?.staticLabel,
    "Product Hunt Top Products",
  );
  assert.equal(
    sourceDefinitionForBuilder({
      kind: BuilderKind.WEBSITE,
      sourceUrl: "https://www.producthunt.com/",
      fetchUrl: null,
    })?.id,
    "product_hunt_top_products",
  );
  assert.equal(builderKindForSourceType("product_hunt_top_products"), BuilderKind.WEBSITE);
  assert.equal(
    builderSourceLabel({
      kind: BuilderKind.BLOG,
      sourceUrl: "https://example.com/blog",
      fetchUrl: null,
    }),
    "Blog",
  );
});

test("GitHub Trending brand backfill covers persisted display names", () => {
  const migration = readFileSync(
    "prisma/migrations/000060_github_trending_persisted_names/migration.sql",
    "utf8",
  );

  assert.match(migration, /UPDATE "Builder"[\s\S]*"sourceType" = 'github_trending'[\s\S]*"name" = 'Github Trending'/);
  assert.match(migration, /UPDATE "BuilderEntity"[\s\S]*"canonicalKey" IN \(/);
  assert.match(migration, /FROM "Builder"[\s\S]*"sourceType" = 'github_trending'/);
  assert.match(migration, /UPDATE "FeedItem"[\s\S]*"sourceName" = 'Github Trending'/);
  assert.match(migration, /SET "name" = 'GitHub Trending'/);
  assert.match(migration, /SET "sourceName" = 'GitHub Trending'/);
});

test("GitHub Trending brand backfill covers historical digest text", () => {
  const migration = readFileSync(
    "prisma/migrations/000061_github_trending_digest_content/migration.sql",
    "utf8",
  );

  assert.match(migration, /UPDATE "Digest"[\s\S]*"content" = replace\("content", 'Github Trending', 'GitHub Trending'\)/);
  assert.match(migration, /"headlineSummary"[\s\S]*replace\("headlineSummary", 'Github Trending', 'GitHub Trending'\)/);
  assert.match(migration, /UPDATE "DigestRun"[\s\S]*"candidates" = replace\("candidates"::text, 'Github Trending', 'GitHub Trending'\)::jsonb/);
  assert.match(migration, /"subscriptions" = replace\("subscriptions"::text, 'Github Trending', 'GitHub Trending'\)::jsonb/);
});

test("source registry supports future source types without new BuilderKind enum values", () => {
  assert.equal(
    sourceTypeIdForBuilder({
      kind: BuilderKind.WEBSITE,
      sourceType: null,
      sourceUrl: "https://example.com/research.pdf",
      fetchUrl: null,
    }),
    "website",
  );
  assert.equal(sourceDefinitionForType("pdf")?.staticLabel, "Website");
  assert.equal(builderKindForSourceType("pdf"), BuilderKind.WEBSITE);
  assert.equal(
    sourceTypeIdForBuilder({
      kind: BuilderKind.WEBSITE,
      sourceType: "CUSTOM_MEDIA",
      sourceUrl: "https://example.com/media",
      fetchUrl: null,
    }),
    "custom_media",
  );
  assert.equal(sourceDefinitionForType("CUSTOM_MEDIA")?.staticLabel, "Custom media");
  assert.equal(builderKindForSourceType("CUSTOM_MEDIA"), BuilderKind.WEBSITE);
});

function recommendationCandidate({
  id,
  title = "Post",
  body,
  builder,
  publishedAt,
}: {
  id: string;
  title?: string;
  body: string;
  builder: RecommendationCandidate["builder"];
  publishedAt: string;
}): RecommendationCandidate {
  return {
    id,
    kind: FeedItemKind.BLOG_POST,
    title,
    body,
    summary: null,
    url: `https://example.com/${id}`,
    publishedAt: new Date(publishedAt),
    createdAt: new Date("2026-05-23T10:00:00.000Z"),
    sourceName: builder?.name ?? "External",
    fetchTool: "test",
    builder,
  };
}

test("content config is per-user, seeded from a system default", () => {
  // Store exposes per-user materialize/resolve/update/reset on top of the
  // default template (which getAllSourceConfigs/getDigestConfig still expose).
  const store = readFileSync("src/lib/source-config-store.ts", "utf8");
  for (const fn of [
    "ensureUserSourceConfigs",
    "getUserSourceConfigs",
    "updateUserSourceConfig",
    "updateUserSourceConfigAndDefault",
    "resetUserSourceConfigs",
    "getUserDigestConfig",
    "updateUserDigestConfig",
    "updateUserDigestConfigAndDefault",
    "resetUserDigestConfig",
  ]) {
    assert.match(store, new RegExp(`export async function ${fn}\\b`));
  }

  // R8: getDigestConfig no longer silently re-creates the default row on a
  // cache miss (which masked a broken seed); a missing row fails loud.
  assert.doesNotMatch(store, /digestConfig\.create\(/);
  assert.match(store, /is missing after/);

  // Per-user editing routes exist; the old admin-only config routes are gone.
  assert.equal(existsSync("src/app/api/settings/source-types/route.ts"), true);
  assert.equal(existsSync("src/app/api/settings/digest-config/route.ts"), true);
  assert.equal(existsSync("src/app/api/admin/source-types/route.ts"), false);
  assert.equal(existsSync("src/app/api/admin/digest-config/route.ts"), false);

  // The settings routes are user-scoped and NOT admin-gated. Admin PATCH
  // additionally updates the system default template used for new users.
  const srcRoute = readFileSync("src/app/api/settings/source-types/route.ts", "utf8");
  const digestRoute = readFileSync("src/app/api/settings/digest-config/route.ts", "utf8");
  assert.match(srcRoute, /defaultFetchDays: z\.number\(\)\.int\(\)\.positive\(\)\.max\(90\)/);
  assert.match(srcRoute, /getUserSourceConfigs\(userId\)/);
  assert.match(srcRoute, /getAllSourceConfigs\(\)/);
  assert.match(srcRoute, /Quality gates can only be changed by an admin/);
  assert.match(srcRoute, /contentQuality: defaultBySourceId\.get\(config\.sourceId\)\?\.contentQuality/);
  assert.match(srcRoute, /updateUserSourceConfig\b/);
  assert.match(srcRoute, /isAdminEmail\(session\.user\.email\)/);
  assert.match(srcRoute, /updateUserSourceConfigAndDefault/);
  assert.match(digestRoute, /isAdminEmail\(session\.user\.email\)/);
  assert.match(digestRoute, /Common fetch and post-summary rules can only be changed by an admin/);
  assert.match(digestRoute, /commonFetchRules: defaultConfig\.commonFetchRules/);
  assert.match(digestRoute, /commonSummaryRules: defaultConfig\.commonSummaryRules/);
  assert.match(digestRoute, /updateUserDigestConfigAndDefault/);
  assert.match(store, /client\(\)\.\$transaction\(/);
  assert.equal(DEFAULT_SOURCE_CONFIGS.github_trending.defaultFetchLimit, 3);
  assert.equal(DEFAULT_SOURCE_CONFIGS.product_hunt_top_products.defaultFetchLimit, 3);
  assert.equal(DEFAULT_SOURCE_CONFIGS.github_trending.defaultFetchDays, 30);
  assert.equal(DEFAULT_SOURCE_CONFIGS.product_hunt_top_products.defaultFetchDays, 30);

  // Settings page shows source/digest config to every user, but only admins can
  // edit the common fetching and post-summary rules shared defaults.
  const settingsPage = readFileSync("src/app/(workspace)/settings/page.tsx", "utf8");
  assert.match(settingsPage, /getUserSourceConfigs\(userId\)/);
  assert.match(settingsPage, /getAllSourceConfigs\(\)/);
  assert.match(settingsPage, /canEditQualityGates=\{isAdmin\}/);
  assert.match(settingsPage, /getUserDigestConfig\(userId\)/);
  assert.doesNotMatch(settingsPage, /Source and digest rules/);
  assert.match(settingsPage, /Source update rules/);
  assert.match(settingsPage, /AI Digest rules/);
  assert.doesNotMatch(settingsPage, />Digest rules</);
  assert.match(settingsPage, /CommonFetchRulesForm/);
  assert.match(settingsPage, /CommonSummaryRulesForm/);
  assert.match(settingsPage, /isAdminEmail\(session\.user\.email\)/);
  assert.match(settingsPage, /isAdmin \?/);

  // Runtime reads resolve source and digest assembly rules to the requesting
  // user's config, but common fetching and post-summary rules always come from
  // the default template admin edits.
  const contextRoute = readFileSync("src/app/api/skill/context/route.ts", "utf8");
  assert.match(contextRoute, /getUserSourceConfigs\(user\.id\)/);
  assert.match(contextRoute, /getAllSourceConfigs\(\)/);
  assert.match(contextRoute, /contentQuality: defaultSourceConfigById\.get\(def\.id\)\?\.contentQuality/);
  assert.match(contextRoute, /getUserDigestConfig\(user\.id\)/);
  assert.match(contextRoute, /getDigestConfig\(\)/);
  assert.match(contextRoute, /commonFetchRules: defaultDigestConfig\.commonFetchRules/);
  assert.match(contextRoute, /commonSummaryRules: defaultDigestConfig\.commonSummaryRules/);
  const buildersRoute = readFileSync("src/app/api/skill/builders/route.ts", "utf8");
  assert.match(buildersRoute, /getAllSourceConfigs\(\)/);
  assert.doesNotMatch(buildersRoute, /getUserSourceConfigs\(user\.id\)/);

  // The editing components post to the per-user endpoints.
  const srcManager = readFileSync("src/components/AdminSourceTypeManager.tsx", "utf8");
  const digestForm = readFileSync("src/components/AdminDigestConfigForm.tsx", "utf8");
  const commonSummaryRulesForm = readFileSync("src/components/CommonSummaryRulesForm.tsx", "utf8");
  assert.match(srcManager, /\/api\/settings\/source-types/);
  assert.match(srcManager, /canEditQualityGates/);
  assert.match(srcManager, /patch\.contentQuality = contentQuality/);
  assert.match(digestForm, /\/api\/settings\/digest-config/);
  assert.match(digestForm, /AI Digest prompts/);
  assert.match(digestForm, /selected AI Digest language/);
  assert.match(digestForm, /Could not save AI Digest prompts\./);
  assert.doesNotMatch(digestForm, /title="Digest prompts"|selected digest language/);
  assert.doesNotMatch(digestForm, /Save failed/);
  assert.doesNotMatch(digestForm, /OrderedChoiceField/);
  assert.doesNotMatch(digestForm, /knownSourceIds/);
  assert.doesNotMatch(digestForm, /digestOrder/);
  assert.doesNotMatch(settingsPage, /knownSourceIds/);
  assert.match(commonSummaryRulesForm, /commonFetchRules/);
  assert.match(commonSummaryRulesForm, /Could not save \$\{title\.toLowerCase\(\)\}\./);
  assert.doesNotMatch(commonSummaryRulesForm, /Save failed/);
  assert.match(commonSummaryRulesForm, /commonSummaryRules/);
  assert.match(commonSummaryRulesForm, /\/api\/settings\/digest-config/);
  assert.doesNotMatch(digestForm, /commonSummaryRules/);

  // Config is no longer described as admin-owned in the agent contract / CLI.
  const contract = readFileSync(
    "skills/builder-blog-digest/jobs/_fetch-task-contract.md",
    "utf8",
  );
  assert.match(contract, /common fetching rules plus your per-source fetch prompt/);
  assert.doesNotMatch(contract, /context\.digest\.order/);
  assert.doesNotMatch(contract, /the admin's per-source fetch prompt/);
});
