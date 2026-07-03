import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { BuilderKind, FeedItemKind } from "@prisma/client";
import {
  ADMIN_FETCH_ONLY_SOURCE_TYPE_IDS,
  isAdminFetchOnlySourceType,
  normalizeAdminFetchOnlySourceType,
} from "../src/lib/admin-fetch-only-sources";
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
import {
  canonicalPersonalSourceUrl,
  personalSourceIdentityKeys,
} from "../src/lib/personal-source-identity";
import { resolvePersonalBuilderInput } from "../src/lib/personal-builder-input";
import {
  candidateSearchTerms,
  didYouMeanSearch,
  mergeSearchSuggestions,
  normalizeRecentSearches,
  parseSearchQuery,
  relatedSearchSuggestions,
  rankSearchDocuments,
  searchDocumentTypeParamValue,
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
import {
  crossTypeWarning,
  detectSourceTypeFromValue,
} from "../src/lib/source-value-detect";

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

test("new users receive a default access key on account creation", () => {
  const auth = readFileSync("src/lib/auth.ts", "utf8");
  const tokens = readFileSync("src/lib/tokens.ts", "utf8");

  assert.match(tokens, /DEFAULT_AGENT_TOKEN_NAME\s*=\s*"Default access key"/);
  assert.match(tokens, /ensureDefaultAgentTokenForUser/);
  assert.match(tokens, /agentToken\.findFirst/);
  assert.match(tokens, /createAgentToken\(userId,\s*DEFAULT_AGENT_TOKEN_NAME\)/);

  assert.match(auth, /ensureDefaultAgentTokenForUser/);
  assert.match(auth, /events:\s*\{/);
  assert.match(auth, /createUser\(\{ user \}\)/);
  assert.match(auth, /ensureDefaultAgentTokenForUser\(user\.id\)/);
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

test("admin-fetch-only source types are normalized and explicit", () => {
  assert.deepEqual(ADMIN_FETCH_ONLY_SOURCE_TYPE_IDS, [
    "github_trending",
    "product_hunt_top_products",
  ]);
  assert.equal(isAdminFetchOnlySourceType("github_trending"), true);
  assert.equal(isAdminFetchOnlySourceType("Product Hunt Top Products"), true);
  assert.equal(normalizeAdminFetchOnlySourceType("GitHub-Trending"), "github_trending");
  assert.equal(isAdminFetchOnlySourceType("blog"), false);
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

test("Blog / Article Feed input accepts article feed URLs as the blog source type", async () => {
  const result = await resolvePersonalBuilderInput({
    displayName: "",
    sourceType: "blog",
    sourceValue: "https://example.com/feed.xml",
  });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    kind: BuilderKind.BLOG,
    sourceType: "blog",
    name: "example.com",
    handle: null,
    sourceUrl: "https://example.com/feed.xml",
    fetchUrl: null,
  });
});

test("Podcast / Audio Feed input accepts podcast feed URLs as the podcast source type", async () => {
  const result = await resolvePersonalBuilderInput({
    displayName: "",
    sourceType: "podcast",
    sourceValue: "https://podcast.example.com/rss",
  });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    kind: BuilderKind.PODCAST,
    sourceType: "podcast",
    name: "podcast.example.com",
    handle: null,
    sourceUrl: "https://podcast.example.com/rss",
    fetchUrl: null,
  });
});

test("source value detection recognizes feed-shaped URLs for automatic source switching", () => {
  assert.equal(detectSourceTypeFromValue("https://x.com/openai"), "x");
  assert.equal(detectSourceTypeFromValue("https://twitter.com/openai"), "x");
  assert.equal(detectSourceTypeFromValue("https://youtube.com/@openai"), "youtube");
  assert.equal(detectSourceTypeFromValue("https://github.com/trending?since=daily"), "github_trending");
  assert.equal(detectSourceTypeFromValue("https://www.producthunt.com/"), "product_hunt_top_products");
  assert.equal(detectSourceTypeFromValue("https://example.com/feed.xml"), "blog");
  assert.equal(detectSourceTypeFromValue("https://example.com/rss"), "blog");
  assert.equal(detectSourceTypeFromValue("https://example.com/?format=atom"), "blog");
  assert.equal(detectSourceTypeFromValue("https://claude.com/blog"), "blog");
  assert.equal(detectSourceTypeFromValue("https://example.com"), "website");
  assert.equal(detectSourceTypeFromValue("https://podcasts.apple.com/us/podcast/example/id123"), "podcast");
  assert.equal(crossTypeWarning("podcast", "https://podcast.example.com/rss"), null);
  assert.deepEqual(crossTypeWarning("website", "https://example.com/feed.xml"), {
    suggestId: "blog",
    message: "This looks like a Blog / Article Feed URL. Switch source type?",
  });
});

test("personal source identity is URL-based across source types", () => {
  assert.equal(
    canonicalPersonalSourceUrl("HTTPS://Claude.com:443/blog/?b=2&a=1#comments"),
    "https://claude.com/blog?a=1&b=2",
  );
  assert.deepEqual(
    [...personalSourceIdentityKeys({
      sourceUrl: "https://claude.com/",
      fetchUrl: "https://claude.com/feed",
    })],
    ["https://claude.com/", "https://claude.com/feed"],
  );
  assert.equal(
    personalSourceIdentityKeys({ sourceUrl: "https://claude.com", fetchUrl: "https://claude.com/" }).size,
    1,
  );
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
  assert.match(buildersPage, /ensureDefaultCommunityLibraryImport\(user\.id\)/);
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
  const personalUpdateRoute = readFileSync("src/app/api/builders/[builderId]/personal/route.ts", "utf8");

  assert.match(libraryRoute, /ownerUserId: session\.user\.id/);
  assert.match(libraryRoute, /ownerUserId === session\.user\.id/);
  assert.match(libraryRoute, /prisma\.feedItem\.deleteMany/);
  assert.match(libraryRoute, /prisma\.builder\.delete/);
  assert.match(libraryRoute, /deletedFeedItems/);
  assert.match(libraryRoute, /BuilderPoolOrigin\.HUB_IMPORT/);

  assert.match(personalUpdateRoute, /confirmedClearFetchedPosts/);
  assert.match(personalUpdateRoute, /needsClearFetchedPostsConfirmation:\s*true/);
  assert.match(personalUpdateRoute, /feedItem\.count\(\{ where: \{ builderId: existing\.id \} \}\)/);
  assert.match(personalUpdateRoute, /feedItem\.deleteMany\(\{ where: \{ builderId: existing\.id \} \}\)/);
  assert.match(personalUpdateRoute, /itemCount:\s*0/);
  assert.match(personalUpdateRoute, /lastFetchedAt:\s*null/);
  assert.match(personalUpdateRoute, /status:\s*FetchStatus\.IDLE/);
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
  const feedSync = readFileSync("src/lib/builder-feed-sync.ts", "utf8");

  assert.match(route, /syncBuilderFeedItems/);
  assert.match(feedSync, /findExistingBuilderForSync/);
  assert.match(feedSync, /isAdminFetchOnlySourceType\(input\.sourceType\)/);
  assert.match(feedSync, /reason: "admin_fetch_only_source"/);
  assert.match(feedSync, /continue/);
  assert.match(feedSync, /builderIdFromItems/);
  assert.match(feedSync, /ownerUserId: mode\.user\.id/);
  assert.match(feedSync, /Referenced source was not found/);
  assert.doesNotMatch(feedSync, /Referenced personal builder was not found/);
});

test("library fetch candidates are recomputed from followed sources every run", () => {
  const contextRoute = readFileSync("src/app/api/skill/context/route.ts", "utf8");
  const cli = readFileSync("scripts/builder-digest.mjs", "utf8");

  assert.match(contextRoute, /const subscribedBuilderIdSet = new Set/);
  assert.match(contextRoute, /if \(!subscribedBuilderIdSet\.has\(builder\.id\)\) return false/);
  assert.match(contextRoute, /isAdminFetchOnlySourceType\(builder\.sourceType\)/);
  assert.match(contextRoute, /fetchDisabledReason: "admin_fetch_only_source"/);
  assert.match(contextRoute, /admin-fetch-only source types are fetched by admin and shared by entity/);
  assert.match(contextRoute, /if \(builder\.ownerUserId === user\.id\) return true/);
  assert.match(contextRoute, /return fetchedItemCountForBuilder\(builder\) === 0/);
  assert.match(contextRoute, /libraryFetchBuilders: annotatedLibraryFetchBuilders/);
  assert.match(contextRoute, /libraryFetchSelection/);
  assert.match(cli, /Array\.isArray\(context\.libraryFetchBuilders\)/);
  assert.match(cli, /return context\.libraryFetchBuilders/);
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
  const libraryOncePrompt = readFileSync("skills/builder-blog-digest/jobs/library-once.md", "utf8");
  const digestOncePrompt = readFileSync("skills/builder-blog-digest/jobs/digest-once.md", "utf8");
  const libraryCronSetupPrompt = readFileSync("skills/builder-blog-digest/jobs/library-cron-setup.md", "utf8");
  const libraryCronStopPrompt = readFileSync("skills/builder-blog-digest/jobs/library-cron-stop.md", "utf8");
  const cloudCronStopPrompt = readFileSync("skills/builder-blog-digest/jobs/cloud-library-cron-stop.md", "utf8");
  const digestCronStopPrompt = readFileSync("skills/builder-blog-digest/jobs/digest-cron-stop.md", "utf8");
  const digestCronSetupPrompt = readFileSync("skills/builder-blog-digest/jobs/digest-cron-setup.md", "utf8");
  const digestCronPrompt = readFileSync("skills/builder-blog-digest/jobs/digest-cron.md", "utf8");

  assert.match(skillJobRoute, /"your Local Agent"/);
  assert.doesNotMatch(skillJobRoute, /"your local agent"/);
  assert.match(skillJobRoute, /insertExchangeAfterInstallStep/);
  assert.match(skillJobRoute, /1a\. Exchange the one-time setup code/);
  assert.match(skillJobRoute, /after installing the skill/);
  assert.doesNotMatch(skillJobRoute, /before step 1/);
  assert.match(skillJobRoute, /If this command fails, stop/);
  assert.match(skillJobRoute, /buildExistingCronWarning/);
  assert.match(skillJobRoute, /serverActiveCron/);
  assert.match(skillJobRoute, /FollowBrief web currently records an active/);
  assert.match(skillJobRoute, /Treat this as an existing schedule even if this machine/);
  assert.doesNotMatch(settingsPanel, /Copy setup command/);
  // The bootstrap curl block was intentionally removed from
  // AgentTokenPanel — users now copy the setup prompt from
  // SkillPromptActions, which references the bootstrap route directly.
  assert.doesNotMatch(settingsPanel, /\/api\/skill\/bootstrap/);
  assert.match(buildersPage, /<SkillPromptActions[\s\S]*context="library"/);
  assert.match(buildersPage, /activeSchedule=\{data\.libraryCronJob\}/);
  assert.match(buildersPage, /compactOnly/);
  assert.match(buildersPage, /showStop=\{showStopLibraryCron\}/);
  assert.match(buildersPage, /<SkillPromptActions[\s\S]*context="digest"/);
  assert.match(buildersPage, /activeSchedule=\{data\.digestCronJob\}/);
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
  assert.match(skillPromptActions, /Build AI Digest/);
  assert.doesNotMatch(skillPromptActions, /Build digest/);
  assert.match(skillPromptActions, /Stop fetching/);
  assert.match(skillPromptActions, /StopScheduleDialog/);
  assert.match(skillPromptActions, /Copy this prompt to stop the active schedule for \{scheduleName\} in your Local Agent/);
  assert.match(skillPromptActions, /Schedule/);
  assert.match(skillPromptActions, /Frequency/);
  assert.match(skillPromptActions, /Runtime/);
  assert.match(skillPromptActions, /Started/);
  assert.match(skillPromptActions, /Device/);
  assert.match(skillPromptActions, /context === "digest" \? "AI Digest" : "Fetch sources"/);
  assert.doesNotMatch(skillPromptActions, /source fetching schedule|Fetch sources schedule/);
  assert.match(skillPromptActions, /onClick=\{openStopDialog\}/);
  assert.match(skillPromptActions, /const token = activeTokens\[0\]/);
  assert.doesNotMatch(skillPromptActions, /Copy stop prompt/);
  assert.doesNotMatch(skillPromptActions, /Run or schedule/);
  assert.doesNotMatch(skillPromptActions, /onClick=\{\(\) => copyCommand\("once"\)\}/);
  assert.match(skillPromptActions, /async function copyTextToClipboard/);
  assert.match(skillPromptActions, /document\.hasFocus\(\)/);
  assert.doesNotMatch(skillPromptActions, /userActivation/);
  assert.match(skillPromptActions, /ManualCopyPromptPanel/);
  assert.match(skillPromptActions, /manual-copy-prompt-\$\{prompt\.target\}/);
  assert.match(skillPromptActions, /Clipboard did not update\. Select the prompt text and copy it\./);
  assert.match(skillPromptActions, /className="skill-prompt-manual-copy"/);
  assert.match(skillPromptActions, /document\.execCommand\("copy"\)/);
  assert.doesNotMatch(skillPromptActions, /await navigator\.clipboard\.writeText\(command\)/);
  assert.match(skillPromptActions, /Read \$\{promptUrl\} and follow the instructions/);
  assert.match(skillPromptActions, /\/api\/skill\/jobs\/\$\{job\}\/skill\.md/);
  // The single job dialog includes one-time as the first frequency option;
  // one-time and recurring selections both pick runtime; recurring selections
  // also pass cadence.
  assert.match(skillPromptActions, /CronConfigDialog/);
  assert.match(skillPromptActions, /FREQUENCY_OPTIONS/);
  assert.match(skillPromptActions, /\{ id: "once", label: "One-time" \}[\s\S]*\{ id: "30m"/);
  assert.match(skillPromptActions, /pickedFreq === "once"/);
  assert.match(skillPromptActions, /target: "once"/);
  assert.match(skillPromptActions, /runtime: pickedRuntime/);
  assert.match(skillPromptActions, /params\.set\("runtime"/);
  assert.match(skillPromptActions, /params\.set\("freq"/);
  assert.match(skillPromptActions, /Frequency/);
  // The override toggle adds ?force=1 only for one-time prompts; cron schedules
  // keep normal incremental boundaries.
  assert.match(skillPromptActions, /OVERRIDE_COPY/);
  assert.match(skillPromptActions, /Re-fetch existing posts/);
  assert.match(skillPromptActions, /Re-fetch existing source posts once/);
  assert.match(skillPromptActions, /isOneTime && runtimeType === "local" \? \(/);
  assert.match(skillPromptActions, /overrideFetched: false/);
  assert.doesNotMatch(skillPromptActions, /Includes posts already in your source library|Refresh existing source library posts|Refresh posts already in library|Refresh posts already saved|Refreshes posts already in your library/);
  assert.doesNotMatch(skillPromptActions, /Re-fetch existing source posts each run|Reuse posts from past issues each run/);
  assert.match(skillPromptActions, /Reuse posts from past issues/);
  assert.doesNotMatch(skillPromptActions, /Reuse past AI Digest posts|Reuse posts from AI Digest issues|Include posts already used in AI Digest issues|Include posts already used in AI Digest archives|Include posts already used in AI Digests/);
  assert.doesNotMatch(skillPromptActions, /Include already digested posts/);
  assert.match(skillPromptActions, /overrideFetched/);
  assert.match(skillPromptActions, /params\.set\("force", "1"\)/);
  // One-time runs now share the schedule dialog instead of a separate button/dialog.
  assert.doesNotMatch(skillPromptActions, /<OnceConfigDialog/);
  assert.match(skillPromptActions, /continueOnceCopy/);
  assert.match(skillPromptActions, /continueOnceCopy\([\s\S]*selection\.runtime[\s\S]*parallelWorkers/);
  assert.match(skillPromptActions, /params\.set\("parallel", String\(extras\.cron\?\.parallelWorkers \?\? extras\.parallelWorkers\)\)/);
  // Cron + once dialogs: compact <select> controls, plus an account-wide
  // summary language select persisted via /api/settings/summary-language —
  // now shown for digest as well as library.
  assert.match(skillPromptActions, /const promptDialogDescription = \(\) => "Set frequency, runtime, language, and lookback\."/);
  assert.doesNotMatch(skillPromptActions, /Copy a Local Agent prompt for Fetch sources\.|Copy a Local Agent prompt for AI Digest\.|Copy a Local Agent prompt to fetch, summarize, and sync sources|Copy a Local Agent prompt to build your AI Digest|Copy a Local Agent prompt\./);
  assert.doesNotMatch(skillPromptActions, /build your digest\./);
  assert.doesNotMatch(skillPromptActions, /build new digests|update every source/);
  assert.match(skillPromptActions, /Local Agent/);
  assert.match(skillPromptActions, /Reuse posts from past issues once\./);
  assert.doesNotMatch(skillPromptActions, /Reuse past AI Digest posts|Reuses posts already used in AI Digest this time\.|Reuses posts from AI Digest issues|Includes posts already used in AI Digest issues|Posts already used in AI Digest issues can be included again this time\.|Posts already used in AI Digest archives can be included again this time\.|Already digested posts can be included again this time\./);
  assert.match(skillPromptActions, /id="cron-fetch-days"[\s\S]*label="Lookback window \(days\)"/);
  assert.doesNotMatch(skillPromptActions, /Max post age \(days\)|Fetch post age \(days\)/);
  assert.match(skillPromptActions, /Default: 30 days\. Range: 1-90\./);
  assert.match(skillPromptActions, /params\.set\("days", String\(extras\.fetchDays\)\)/);
  assert.match(skillPromptActions, /Number\.isInteger\(numeric\)/);
  assert.match(skillPromptActions, /numeric < 1 \|\| numeric > MAX_PROMPT_WINDOW_DAYS/);
  assert.doesNotMatch(skillPromptActions, /Math\.min\(MAX_PROMPT_WINDOW_DAYS, Math\.max\(1/);
  assert.match(skillPromptActions, /Lookback window must be a whole number from 1 to 90 days/);
  assert.doesNotMatch(skillPromptActions, /Max post age must be a whole number|Fetch days must be a whole number/);
  assert.match(skillPromptActions, /\{submitting \? "Copying" : "Copy prompt"\}/);
  assert.match(skillPromptActions, /\{copying \? "Copying" : "Copy"\}/);
  assert.doesNotMatch(skillPromptActions, /Prepare prompt|Preparing|Prepared prompt/);
  assert.doesNotMatch(skillPromptActions, /\{submitting \? "…" : "Copy"\}|Copying\.\.\./);
  assert.doesNotMatch(skillPromptActions, /Copy a prompt for one run or for a recurring local schedule/);
  assert.doesNotMatch(skillPromptActions, /Local helper|connected helpers|Connected helpers/);
  assert.doesNotMatch(skillPromptActions, /Choose a Local Agent/);
  assert.match(skillPromptActions, /No access keys yet/);
  assert.doesNotMatch(skillPromptActions, /No Local Agent access yet/);
  assert.match(skillPromptActions, /Add an access key to set up Local Agent runs\./);
  assert.doesNotMatch(skillPromptActions, /Add an access key to copy Local Agent prompts\./);
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
  const languagePreference = readFileSync("src/lib/language-preference.ts", "utf8");
  assert.match(settingsFields, /ORIGINAL_CONTENT_LANGUAGE_VALUE/);
  assert.match(settingsFields, /label: ORIGINAL_CONTENT_LANGUAGE_LABEL/);
  assert.doesNotMatch(settingsFields, /Use \$\{ORIGINAL_CONTENT_LANGUAGE_LABEL/);
  assert.match(languagePreference, /ORIGINAL_CONTENT_LANGUAGE_LABEL = "original"/);
  assert.match(languagePreference, /LEGACY_ORIGINAL_CONTENT_LANGUAGE_LABEL = "Original content language"/);
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
  // Server validates freq against a whitelist and substitutes cadence metadata;
  // the setup prompt derives the concrete cron/launchd schedule from the
  // install-time anchor after validation succeeds.
  assert.match(skillJobRoute, /cronFrequencies/);
  assert.match(skillJobRoute, /new Set\(\["claude", "codex", "hermes", "openclaw"\]\)/);
  assert.match(skillJobRoute, /hermes: "Hermes"/);
  assert.match(skillPromptActions, /id: "hermes"/);
  assert.match(skillPromptActions, /label: "Hermes"/);
  assert.doesNotMatch(`${skillJobRoute}\n${skillPromptActions}`, /Gemini CLI|id: "gemini"|gemini: "Gemini CLI"/);
  assert.match(skillJobRoute, /openclaw: "OpenClaw"/);
  assert.match(skillPromptActions, /id: "openclaw"/);
  assert.match(skillPromptActions, /label: "OpenClaw"/);
  assert.match(skillPromptActions, /Every day/);
  assert.match(skillPromptActions, /Every week/);
  assert.doesNotMatch(skillPromptActions, /08:00|Mon 08:00/);
  assert.match(skillJobRoute, /searchParams\.get\("freq"\)/);
  assert.match(skillJobRoute, /boundedIntegerParam\(url\.searchParams, "days", 30, 1, 90\)/);
  assert.match(skillJobRoute, /searchParams\.get\("parallel"\)/);
  assert.match(skillJobRoute, /Number\.isInteger\(parallelRaw\)/);
  assert.match(skillJobRoute, /\{\{FETCH_DAYS\}\}/);
  assert.match(skillJobRoute, /\{\{PARALLEL_WORKERS\}\}/);
  assert.doesNotMatch(skillJobRoute, /\{\{CLOUD_FETCH_LIMIT\}\}/);
  assert.match(skillJobRoute, /\{\{FETCH_LIMIT\}\}/);
  assert.match(skillJobRoute, /\{\{CRON_FREQUENCY_KEY\}\}/);
  assert.match(skillJobRoute, /\{\{CRON_FREQUENCY_LABEL\}\}/);
  assert.match(skillJobRoute, /\{\{CRON_TIMEOUT_SECONDS\}\}/);
  assert.match(skillJobRoute, /localAgentTimeoutSeconds/);
  assert.match(skillJobRoute, /cronTimeoutJob/);
  assert.match(skillJobRoute, /openClawSetupTimeoutSeconds/);
  assert.match(skillJobRoute, /job === "library-cron-setup"[\s\S]*\? "library-cron"/);
  assert.match(skillJobRoute, /job === "digest-cron-setup"[\s\S]*\? "digest-cron"/);
  assert.match(skillJobRoute, /localAgentTimeoutSeconds\(cronInterval, cronTimeoutJob\)/);
  assert.doesNotMatch(skillJobRoute, /localAgentTimeoutSeconds\(cronInterval, job\)/);
  assert.match(skillJobRoute, /buildOpenClawInitialRunBootstrap/);
  assert.match(skillJobRoute, /sliceSetupPromptForOpenClawChild/);
  assert.match(skillJobRoute, /sliceSetupPromptForOpenClawParent/);
  assert.match(skillJobRoute, /adaptSetupContinuationForUnattendedChild/);
  assert.match(skillJobRoute, /content\.slice\(markerIndex\)\.trimStart\(\)/);
  assert.match(skillJobRoute, /sliceSetupPromptForOpenClawChild\(job, contentWithExchange\)/);
  assert.match(skillJobRoute, /sliceSetupPromptForOpenClawParent\(job, contentWithExchange, openClawSetupBootstrap\)/);
  assert.match(skillJobRoute, /Queue the OpenClaw initial run/);
  assert.match(skillJobRoute, /searchParams\.get\("openclaw_setup_child"\)/);
  assert.match(skillJobRoute, /searchParams\.get\("setup_account"\)/);
  assert.match(skillJobRoute, /!openClawSetupChild/);
  assert.match(skillJobRoute, /withOpenClawSetupChildParams\(request\.url, accountEmail\)/);
  assert.match(skillJobRoute, /searchParams\.delete\("ec"\)/);
  assert.match(skillJobRoute, /searchParams\.set\("setup_account", email\)/);
  assert.match(skillJobRoute, /openClawSetupChild[\s\S]*Setup account missing or invalid/);
  assert.match(skillJobRoute, /OPENCLAW_CHILD_SETUP_PROMPT_URL/);
  assert.match(skillJobRoute, /openclaw cron add/);
  assert.match(skillJobRoute, /--session isolated/);
  assert.match(skillJobRoute, /--light-context/);
  assert.match(skillJobRoute, /--timeout-seconds \\"\$OPENCLAW_SETUP_TIMEOUT_SECONDS\\"/);
  assert.match(skillJobRoute, /FOLLOWBRIEF_OPENCLAW_QUEUED=1/);
  assert.match(skillJobRoute, /Run this queued FollowBrief setup continuation/);
  assert.match(skillJobRoute, /numbering continues from the[\s\S]*user-facing setup prompt/);
  assert.match(skillJobRoute, /This child job is[\s\S]*unattended and must not wait for confirmation/);
  assert.match(skillJobRoute, /openClawSetupChild[\s\S]*sliceSetupPromptForOpenClawChild/);
  assert.match(skillJobRoute, /openClawSetupBootstrap[\s\S]*sliceSetupPromptForOpenClawParent/);
  assert.doesNotMatch(skillJobRoute, /FOLLOWBRIEF_OPENCLAW_SETUP_DETACHED/);
  assert.doesNotMatch(skillJobRoute, /FOLLOWBRIEF_OPENCLAW_DETACHED=1/);
  assert.doesNotMatch(skillJobRoute, /nohup openclaw agent/);
  assert.match(skillJobRoute, /openClawSetupBootstrap[\s\S]*exchangeBlock[\s\S]*content/);
  assert.doesNotMatch(skillJobRoute, /job\.startsWith\("library"\) \? 75 \* 60 : 45 \* 60/);
  // macOS scheduling uses a launchd LaunchAgent with anchor-aligned
  // StartCalendarInterval entries instead of a forever one-minute tick.
  assert.doesNotMatch(skillJobRoute, /<key>StartInterval<\/key>/);
  assert.doesNotMatch(skillJobRoute, /<integer>60<\/integer>/);
  assert.match(skillJobRoute, /\{\{CRON_INTERVAL_SECONDS\}\}/);
  assert.doesNotMatch(skillJobRoute, /\{\{LAUNCHD_SCHEDULE\}\}/);
  // Forced re-fetch toggle: ?force=1 → {{FETCH_FORCE}} substituted to 1.
  assert.match(skillJobRoute, /searchParams\.get\("force"\)/);
  assert.match(skillJobRoute, /\{\{FETCH_FORCE\}\}/);
  // {{FETCH_FLAG}} bakes the one-time override choice into the runner env; the
  // files route neutralizes it to "" for the cached prompt copy.
  assert.match(skillJobRoute, /\{\{FETCH_FLAG\}\}/);
  assert.match(skillFileRoute, /\{\{FETCH_FLAG\}\}/);
  assert.match(skillFileRoute, /\{\{FETCH_DAYS\}\}/);
  assert.match(skillFileRoute, /replaceAll\("\{\{AGENT_RUNTIME\}\}", ""\)/);
  assert.match(skillFileRoute, /replaceAll\("\{\{FETCH_DAYS\}\}", "30"\)/);
  assert.match(skillFileRoute, /replaceAll\("\{\{PARALLEL_WORKERS\}\}", "1"\)/);
  // cron-setup prompts generate an anchor-aligned schedule after the
  // validation run passes, then install via launchd on macOS / crontab on Linux.
  assert.match(libraryCronSetupPrompt, /schedule-spec/);
  assert.match(libraryCronSetupPrompt, /--anchor-file "\$ANCHOR_FILE"/);
  assert.match(libraryCronSetupPrompt, /--cron-out "\$SCHEDULE_SPEC_DIR\/cron\.txt"/);
  assert.match(libraryCronSetupPrompt, /--launchd-out "\$SCHEDULE_SPEC_DIR\/launchd\.xml"/);
  assert.match(libraryCronSetupPrompt, /--status-out "\$SCHEDULE_SPEC_DIR\/status\.txt"/);
  assert.match(libraryCronSetupPrompt, /CRON_SCHEDULE_EXPR="\$\(cat "\$SCHEDULE_SPEC_DIR\/cron\.txt"\)"/);
  assert.match(libraryCronSetupPrompt, /LAUNCHD_SCHEDULE_XML="\$\(cat "\$SCHEDULE_SPEC_DIR\/launchd\.xml"\)"/);
  assert.doesNotMatch(libraryCronSetupPrompt, /\{\{CRON_SCHEDULE\}\}/);
  assert.match(libraryCronSetupPrompt, /\{\{CRON_FREQUENCY_KEY\}\}/);
  assert.match(libraryCronSetupPrompt, /\{\{CRON_FREQUENCY_LABEL\}\}/);
  assert.doesNotMatch(libraryCronSetupPrompt, /\{\{LAUNCHD_SCHEDULE\}\}/);
  assert.doesNotMatch(libraryCronSetupPrompt, /<key>StartInterval<\/key>/);
  assert.match(libraryCronSetupPrompt, /StartCalendarInterval/);
  assert.match(libraryCronSetupPrompt, /<key>BUILDER_BLOG_INTERVAL_MINUTES<\/key><string>\{\{CRON_INTERVAL_MINUTES\}\}<\/string>/);
  assert.match(libraryCronSetupPrompt, /<key>INTERVAL_MINUTES<\/key><string>\{\{CRON_INTERVAL_MINUTES\}\}<\/string>/);
  assert.match(libraryCronSetupPrompt, /<key>BUILDER_BLOG_SCHEDULER_TICK<\/key><string>1<\/string>/);
  assert.match(libraryCronSetupPrompt, /schedule-anchor-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronSetupPrompt, /launchctl bootstrap/);
  assert.match(libraryCronSetupPrompt, /LaunchAgents/);
  assert.match(libraryCronSetupPrompt, /verify this account's local credential/);
  assert.match(libraryCronSetupPrompt, /Account file not found for \$ACCT/);
  assert.match(libraryCronSetupPrompt, /Stop before installing the schedule/);
  assert.match(libraryCronSetupPrompt, /parallel-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronSetupPrompt, /\{\{PARALLEL_WORKERS\}\}/);
  assertOrderedText(libraryCronSetupPrompt, [
    "Create required directories and verify this account's local credential",
    "Account file not found for $ACCT",
    "Before changing anything, check whether this account's library fetch cron",
    "Keep the selected runtime and fetch mode scoped",
  ]);
  assert.doesNotMatch(libraryCronSetupPrompt, /0 \*\/6 \* \* \*/);
  assert.match(digestCronSetupPrompt, /schedule-spec/);
  assert.match(digestCronSetupPrompt, /--anchor-file "\$ANCHOR_FILE"/);
  assert.match(digestCronSetupPrompt, /CRON_SCHEDULE_EXPR="\$\(cat "\$SCHEDULE_SPEC_DIR\/cron\.txt"\)"/);
  assert.match(digestCronSetupPrompt, /LAUNCHD_SCHEDULE_XML="\$\(cat "\$SCHEDULE_SPEC_DIR\/launchd\.xml"\)"/);
  assert.doesNotMatch(digestCronSetupPrompt, /\{\{CRON_SCHEDULE\}\}/);
  assert.doesNotMatch(digestCronSetupPrompt, /\{\{LAUNCHD_SCHEDULE\}\}/);
  assert.doesNotMatch(digestCronSetupPrompt, /<key>StartInterval<\/key>/);
  assert.match(digestCronSetupPrompt, /StartCalendarInterval/);
  assert.match(digestCronSetupPrompt, /<key>BUILDER_BLOG_INTERVAL_MINUTES<\/key><string>\{\{CRON_INTERVAL_MINUTES\}\}<\/string>/);
  assert.match(digestCronSetupPrompt, /<key>INTERVAL_MINUTES<\/key><string>\{\{CRON_INTERVAL_MINUTES\}\}<\/string>/);
  assert.match(digestCronSetupPrompt, /launchctl bootstrap/);
  assert.match(digestCronSetupPrompt, /verify this account's local credential/);
  assert.match(digestCronSetupPrompt, /Account file not found for \$ACCT/);
  assert.match(digestCronSetupPrompt, /Stop before installing the schedule/);
  assertOrderedText(digestCronSetupPrompt, [
    "Create required directories and verify this account's local credential",
    "Account file not found for $ACCT",
    "Before changing anything, check whether this account's digest cron",
    "Keep the selected runtime and digest mode scoped",
  ]);
  assert.doesNotMatch(digestCronSetupPrompt, /0 8 \* \* \*/);

  // Digest "re-generate today's digest": the same ?force=1 channel drives
  // digest-specific placeholders. The once command bakes --regenerate inline;
  // the cron flow pins it to disk and the runner re-exports it.
  assert.match(skillJobRoute, /\{\{DIGEST_REGENERATE\}\}/);
  assert.match(skillJobRoute, /\{\{DIGEST_REGENERATE_FLAG\}\}/);
  assert.match(digestOncePrompt, /BUILDER_BLOG_DIGEST_REGENERATE="\$\{BUILDER_BLOG_DIGEST_REGENERATE-\{\{DIGEST_REGENERATE_FLAG\}\}\}"/);
  assert.doesNotMatch(digestCronPrompt, /BUILDER_BLOG_DIGEST_REGENERATE/);
  assert.match(digestCronSetupPrompt, /\{\{DIGEST_REGENERATE\}\}/);
  assert.match(digestCronSetupPrompt, /BUILDER_BLOG_DIGEST_REGENERATE="\{\{DIGEST_REGENERATE_FLAG\}\}"/);
  assert.match(digestCronSetupPrompt, /regenerate-digest-cron/);
  assert.match(runner, /BUILDER_BLOG_DIGEST_REGENERATE/);
  assert.match(runner, /INCOMING_DIGEST_REGENERATE_SET/);
  assert.match(runner, /read_pin regenerate/);
  assert.match(cli, /--regenerate/);
  assert.match(cli, /&regenerate=1/);
  assert.match(cli, /&dryRun=1/);
  assert.match(cli, /source=\$\{encodeURIComponent\(runSource\)\}/);
  assert.match(cli, /regenerateDigest/);
  assert.match(cli, /cron-status/);
  assert.match(cli, /api\/skill\/cron-jobs/);
  // The digest-writing instructions (incl. the context.language rule) live in
  // the shared digest-cron payload. digest-once is only the tracked runner entry.
  assert.doesNotMatch(digestOncePrompt, /\{\{INCLUDE:digest-task-contract TMP_JOB="digest-once"\}\}/);
  assert.match(digestCronPrompt, /\{\{INCLUDE:digest-task-contract TMP_JOB="digest-cron"\}\}/);
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
  // The fetch-task / summarize execution contract is a set of shared
  // fragments (discovery → per-task core → validate/sync tail). The scheduled
  // job pulls all three in via {{INCLUDE:...}} directives expanded server-side,
  // while the one-time prompt is intentionally only a thin wrapper around
  // builder-agent-runner.sh library-once. That keeps copied one-time prompts on
  // the same runner path as "run the schedule now" instead of duplicating a
  // second direct fetch/sync implementation.
  const fetchTaskDiscovery = readFileSync(
    "skills/builder-blog-digest/jobs/_fetch-task-discovery.md",
    "utf8",
  );
  const fetchTaskCore = readFileSync(
    "skills/builder-blog-digest/jobs/_fetch-task-core.md",
    "utf8",
  );
  const fetchTaskSyncing = readFileSync(
    "skills/builder-blog-digest/jobs/_fetch-task-syncing.md",
    "utf8",
  );
  const fetchTaskContract = [fetchTaskDiscovery, fetchTaskCore, fetchTaskSyncing].join("\n");
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
        /\{\{INCLUDE:fetch-task-discovery TMP_JOB="([^"]*)"\}\}/g,
        (_m, tmpJob) =>
          fetchTaskDiscovery
            .replace(/^\s*<!--[\s\S]*?-->\s*/, "")
            .replaceAll("{{TMP_JOB}}", tmpJob)
            .trim(),
      )
      .replace(
        /\{\{INCLUDE:fetch-task-core REPORT_TARGET="([^"]*)"\}\}/g,
        (_m, target) =>
          fetchTaskCore
            .replace(/^\s*<!--[\s\S]*?-->\s*/, "")
            .replaceAll("{{REPORT_TARGET}}", target)
            .trim(),
      )
      .replace(
        /\{\{INCLUDE:fetch-task-syncing REPORT_TARGET="([^"]*)" TMP_JOB="([^"]*)"\}\}/g,
        (_m, target, tmpJob) =>
          fetchTaskSyncing
            .replace(/^\s*<!--[\s\S]*?-->\s*/, "")
            .replaceAll("{{REPORT_TARGET}}", target)
            .replaceAll("{{TMP_JOB}}", tmpJob)
            .trim(),
      )
      .replace(
        /\{\{INCLUDE:digest-task-contract TMP_JOB="([^"]*)"\}\}/g,
        (_m, tmpJob) =>
          digestTaskContract
            .replace(/^\s*<!--[\s\S]*?-->\s*/, "")
            .replaceAll("{{TMP_JOB}}", tmpJob)
            .trim(),
      );
  }
  const libraryOnceExpanded = expandIncludes(libraryOncePrompt);
  const digestCronExpanded = expandIncludes(digestCronPrompt);

  // Anti-drift: one-time source fetch invokes the runner; it must not restate
  // fetch-personal, validation, sync, or the task contract inline.
  assert.match(libraryOncePrompt, /builder-agent-runner\.sh" library-once/);
  assert.match(libraryOncePrompt, /BUILDER_BLOG_FETCH_DAYS/);
  assert.match(libraryOncePrompt, /BUILDER_BLOG_FETCH_FORCE/);
  assert.match(libraryOncePrompt, /BUILDER_BLOG_PARALLEL_WORKERS/);
  assert.doesNotMatch(libraryOncePrompt, /\{\{INCLUDE:fetch-task-/);
  assert.doesNotMatch(libraryOncePrompt, /fetch-personal/);
  assert.doesNotMatch(libraryOncePrompt, /validate-agent-sync/);
  assert.doesNotMatch(libraryOncePrompt, /sync-builders/);

  // Scheduled source fetch is runner-owned now. There is no library-cron prompt
  // file; discovery and worker prompts are the only agent payloads for fetch work.
  assert.doesNotMatch(skillJobFiles, /"library-cron":/);
  assert.doesNotMatch(skillFileRoute, /builder-blog-library-cron\.md/);
  assert.doesNotMatch(runner, /builder-blog-library-cron\.md/);
  assert.doesNotMatch(bootstrapRoute, /builder-blog-library-cron\.md/);
  const libraryDiscoveryPrompt = readFileSync(
    "skills/builder-blog-digest/jobs/library-discovery.md",
    "utf8",
  );
  const libraryWorkerPrompt = readFileSync(
    "skills/builder-blog-digest/jobs/library-worker.md",
    "utf8",
  );
  const libraryWorkerExpanded = expandIncludes(libraryWorkerPrompt);
  assert.match(libraryDiscoveryPrompt, /\{\{INCLUDE:fetch-task-discovery TMP_JOB="library-cron"\}\}/);
  assert.doesNotMatch(libraryDiscoveryPrompt, /builder-digest\.mjs"?\s+expand-discovery/);
  assert.doesNotMatch(libraryDiscoveryPrompt, /builder-digest\.mjs"?\s+validate-agent-sync/);
  assert.doesNotMatch(libraryDiscoveryPrompt, /builder-digest\.mjs"?\s+sync-builders/);
  assert.match(libraryWorkerPrompt, /\{\{INCLUDE:fetch-task-core REPORT_TARGET="[^"]+"\}\}/);
  assert.doesNotMatch(libraryWorkerPrompt, /\{\{INCLUDE:fetch-task-discovery/);
  assert.doesNotMatch(libraryWorkerPrompt, /\{\{INCLUDE:fetch-task-syncing/);
  assert.doesNotMatch(libraryWorkerPrompt, /builder-digest\.mjs"?\s+validate-agent-sync/);
  assert.doesNotMatch(libraryWorkerPrompt, /How to execute each `fetchTask`/);
  assert.doesNotMatch(libraryOncePrompt, /How to execute each `fetchTask`/);
  // Expansion leaves no unresolved placeholders.
  assert.doesNotMatch(libraryOnceExpanded, /\{\{INCLUDE|\{\{REPORT_TARGET\}\}|\{\{TMP_JOB\}\}/);
  assert.doesNotMatch(libraryWorkerExpanded, /\{\{INCLUDE|\{\{REPORT_TARGET\}\}|\{\{TMP_JOB\}\}/);

  // The one-time wrapper carries the per-run URL choices into the runner, so a
  // pasted prompt still uses the same days/force/parallel inputs as the
  // scheduled path without duplicating cron's shell steps.
  assert.match(
    libraryOnceExpanded,
    /BUILDER_BLOG_FETCH_DAYS="\$\{BUILDER_BLOG_FETCH_DAYS-\{\{FETCH_DAYS\}\}\}"/,
  );
  assert.match(
    libraryOnceExpanded,
    /BUILDER_BLOG_FETCH_FORCE="\$\{BUILDER_BLOG_FETCH_FORCE-\{\{FETCH_FLAG\}\}\}"/,
  );
  assert.match(
    libraryOnceExpanded,
    /BUILDER_BLOG_PARALLEL_WORKERS="\$\{BUILDER_BLOG_PARALLEL_WORKERS-\{\{PARALLEL_WORKERS\}\}\}"/,
  );
  assert.match(libraryOnceExpanded, /Run only the numbered shell blocks below, in order/);
  assert.doesNotMatch(libraryOnceExpanded, /Environment contract/);
  assertOrderedText(libraryOnceExpanded, [
    "1. Install or refresh the skill",
    "2. Run one source fetch through the FollowBrief runner",
    "3. Report the runner output",
  ]);
  // Per-task contract content lives only in the worker prompt now.
  assert.match(libraryWorkerExpanded, /Build one output item/);
  assert.match(libraryWorkerExpanded, /rawJson\.agentExecutionProof/);
  assert.match(libraryWorkerExpanded, /complete exactly\s+the task IDs returned by the CLI/i);
  assert.match(libraryWorkerExpanded, /fetchTasks/);
  assert.match(libraryWorkerExpanded, /BUILDER_BLOG_JOB_TMP_DIR/);
  assert.match(libraryWorkerExpanded, /Globally installed tools[\s\S]*normal binary, package, model, and auth[\s\S]*caches may live outside this directory/);
  assert.match(libraryWorkerExpanded, /Per-job content artifacts from this[\s\S]*run must stay under `\$BUILDER_BLOG_JOB_TMP_DIR`/);
  assert.match(libraryWorkerExpanded, /audio\/video downloads,[\s\S]*subtitles, transcripts, browser profiles, screenshots, page dumps, and scratch[\s\S]*files/);
  assert.match(libraryWorkerExpanded, /Do not\s+read or reuse local artifacts from other accounts/);
  assert.match(libraryWorkerExpanded, /Never read from `~\/\.builder-blog\/tmp\/accounts\/<other account>`/);
  assert.match(libraryWorkerExpanded, /single-post\s+`?summary`?/);
  assert.match(libraryWorkerExpanded, /summaryInstructions\.prompt/);
  assert.match(libraryWorkerExpanded, /only prompt source for fetch-task\s+summaries/);
  assert.match(libraryWorkerExpanded, /Do not re-compose it from[\s\S]*`context\.sources`/);
  assert.match(libraryWorkerExpanded, /Lifecycle vocabulary for this contract/);
  assert.match(libraryWorkerExpanded, /Read `task\.contentStatus`/);
  assert.match(libraryWorkerExpanded, /Copy `task\.builderSync` exactly/);
  assert.match(libraryWorkerExpanded, /Use `task\.minimumContentQuality`/);
  assert.match(libraryWorkerExpanded, /set `body`, set `summary`/);
  assert.match(libraryWorkerExpanded, /task\.builderSync/);
  assert.match(libraryWorkerExpanded, /Do not add new sources, URLs, or feed items/);
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
  for (const fragment of [
    "_fetch-task-discovery.md",
    "_fetch-task-core.md",
    "_fetch-task-syncing.md",
    "local-agent-timeouts.json",
  ]) {
    assert.ok(
      tracingForFilesRoute.includes(fragment),
      `files-route tracing is missing ${fragment}`,
    );
    assert.ok(
      tracingForJobsRoute.includes(fragment),
      `jobs-route tracing is missing ${fragment}`,
    );
  }
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
  assert.match(digestOncePrompt, /builder-agent-runner\.sh" digest-once/);
  assert.doesNotMatch(digestOncePrompt, /builder-digest\.mjs" prepare/);
  assert.doesNotMatch(digestOncePrompt, /render-digest/);
  assert.doesNotMatch(digestOncePrompt, /builder-digest\.mjs" sync/);
  for (const oncePrompt of [libraryOncePrompt, digestOncePrompt]) {
    assert.match(oncePrompt, /exits with code 75 and says a one-time FollowBrief run is already/);
    assert.match(oncePrompt, /ask the user whether to replace the active one-time run/);
    assert.match(oncePrompt, /BUILDER_BLOG_REPLACE_ACTIVE_ONETIME=1/);
    assert.match(oncePrompt, /Do not set this flag for any other failure/);
  }
  assert.match(digestOncePrompt, /Run only the numbered shell blocks below, in order/);
  assert.match(digestOncePrompt, /It owns candidate preparation,[\s\S]*summary JSON handoff, rendering/);
  assert.doesNotMatch(digestOncePrompt, /JSON schema, or success criteria/);
  assert.doesNotMatch(libraryOncePrompt, /JSON schema, or success criteria/);
  assert.doesNotMatch(digestOncePrompt, /Environment contract/);
  assert.match(digestOncePrompt, /BUILDER_BLOG_JOB_TMP_DIR=/);
  assert.match(libraryOncePrompt, /BUILDER_BLOG_AGENT_RUNTIME="\$\{BUILDER_BLOG_AGENT_RUNTIME-\{\{AGENT_RUNTIME\}\}\}"/);
  assert.match(digestOncePrompt, /BUILDER_BLOG_AGENT_RUNTIME="\$\{BUILDER_BLOG_AGENT_RUNTIME-\{\{AGENT_RUNTIME\}\}\}"/);
  const cloudCronSetupPrompt = readFileSync(
    "skills/builder-blog-digest/jobs/cloud-library-cron-setup.md",
    "utf8",
  );
  assert.doesNotMatch(skillJobFiles, /cloud-library-once/);
  assert.match(cloudCronSetupPrompt, /Check whether a local cloud worker host or active cloud worker is already running/);
  assert.match(cloudCronSetupPrompt, /ACTIVE_CLOUD_WORKER/);
  assert.match(cloudCronSetupPrompt, /NO_ACTIVE_CLOUD_WORKER/);
  assert.match(cloudCronSetupPrompt, /ask the user whether to replace that active/);
  assert.match(cloudCronSetupPrompt, /cloud-library-host\/current\.json/);
  assert.match(cloudCronSetupPrompt, /cloud-library-cron\/current\.json/);
  assert.match(cloudCronStopPrompt, /Stop the FollowBrief Cloud worker host/);
  assert.match(cloudCronStopPrompt, /cloud-library-host\/current\.json/);
  assert.match(cloudCronStopPrompt, /cloud-library-cron\/current\.json/);
  assert.match(cloudCronStopPrompt, /--job-type cloud-library-fetch/);
  assert.match(cloudCronStopPrompt, /--status killed/);
  assert.doesNotMatch(cloudCronStopPrompt, /cron-status/);
  assert.match(digestOncePrompt, /tmp\/accounts\/\$ACCOUNT_SLUG\/digest-once/);
  assert.match(libraryCronSetupPrompt, /builder-agent-runner\.sh library-cron/);
  assert.doesNotMatch(libraryCronSetupPrompt, /BUILDER_BLOG_AGENT_TIMEOUT_SECONDS=300/);
  assert.match(libraryCronSetupPrompt, /BUILDER_BLOG_WORKER_MODE=1/);
  assert.match(libraryCronSetupPrompt, /BUILDER_BLOG_JOB_TRIGGER=one_time/);
  assert.doesNotMatch(libraryCronSetupPrompt, /BUILDER_BLOG_SMOKE_CHECK=1/);
  assert.doesNotMatch(libraryCronSetupPrompt, /followbriefSmokeCheck/);
  assert.doesNotMatch(libraryCronSetupPrompt, /BUILDER_BLOG_DISABLE_WEB_SYNC=1/);
  assert.doesNotMatch(libraryCronSetupPrompt, /BUILDER_BLOG_FETCH_LIMIT=1/);
  assert.match(libraryCronSetupPrompt, /BUILDER_BLOG_FETCH_DAYS="\{\{FETCH_DAYS\}\}"/);
  assert.match(libraryCronSetupPrompt, /BUILDER_BLOG_INTERVAL_MINUTES="\{\{CRON_INTERVAL_MINUTES\}\}"/);
  assert.match(
    libraryCronSetupPrompt,
    /BUILDER_BLOG_WORKER_MODE=1 \\\s+BUILDER_BLOG_JOB_TRIGGER=one_time \\\s+BUILDER_BLOG_AGENT_RUNTIME="\{\{AGENT_RUNTIME\}\}" \\\s+BUILDER_BLOG_FETCH_FORCE="\{\{FETCH_FLAG\}\}" \\\s+BUILDER_BLOG_FETCH_DAYS="\{\{FETCH_DAYS\}\}"/,
  );
  assert.match(libraryCronSetupPrompt, /INTERVAL_MINUTES="\{\{CRON_INTERVAL_MINUTES\}\}"/);
  assert.doesNotMatch(libraryCronSetupPrompt, /webSyncDisabled: true/);
  assert.match(libraryCronStopPrompt, /cron-status/);
  assert.match(libraryCronStopPrompt, /--status stopped/);
  assert.match(libraryCronStopPrompt, /ACCT="\$\{BUILDER_BLOG_ACCOUNT\}"/);
  assert.match(libraryCronStopPrompt, /runtime-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronStopPrompt, /fetch-force-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronStopPrompt, /fetch-days-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronStopPrompt, /parallel-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronStopPrompt, /tmp\/accounts\/\$ACCOUNT_SLUG\/library-cron\/current\.json/);
  assert.ok(
    skillJobRoute.includes("([ \\t]*)"),
    "skill job account injection must preserve indentation for nested job-run-update commands",
  );
  {
    const accountEnv = 'BUILDER_BLOG_ACCOUNT="jie@worldstatelabs.com"';
    const sampleStopBlock = [
      '    node "$AGENT_DIR/builder-digest.mjs" job-run-update \\',
      "      --job-type library-fetch",
    ].join("\n");
    const rendered = sampleStopBlock.replace(
      /(^|\n)([ \t]*)(?:BUILDER_BLOG_ACCOUNT="[^"]*"\s*\\\n[ \t]*)?(node\s+[^\n]*builder-digest\.mjs[^\n]*)/gm,
      (_m: string, lineStart: string, indent: string, nodeCmd: string) =>
        `${lineStart}${indent}${accountEnv} \\\n${indent}${nodeCmd}`,
    );
    assert.match(
      rendered,
      /    BUILDER_BLOG_ACCOUNT="jie@worldstatelabs\.com" \\\n    node "\$AGENT_DIR\/builder-digest\.mjs" job-run-update/,
    );
  }
  assert.doesNotMatch(libraryCronStopPrompt, /Do not\s+exchange a token or make any network call/);
  assert.doesNotMatch(digestCronSetupPrompt, /BUILDER_BLOG_AGENT_TIMEOUT_SECONDS=300/);
  assert.match(digestCronSetupPrompt, /BUILDER_BLOG_WORKER_MODE=1/);
  assert.match(digestCronSetupPrompt, /BUILDER_BLOG_JOB_TRIGGER=one_time/);
  assert.doesNotMatch(digestCronSetupPrompt, /BUILDER_BLOG_SMOKE_CHECK=1/);
  assert.doesNotMatch(digestCronSetupPrompt, /followbriefSmokeCheck/);
  assert.doesNotMatch(digestCronSetupPrompt, /BUILDER_BLOG_DISABLE_WEB_SYNC=1/);
  assert.match(digestCronSetupPrompt, /INTERVAL_MINUTES="\{\{CRON_INTERVAL_MINUTES\}\}"/);
  assert.match(digestCronSetupPrompt, /BUILDER_BLOG_INTERVAL_MINUTES="\{\{CRON_INTERVAL_MINUTES\}\}"/);
  assert.doesNotMatch(digestCronSetupPrompt, /webSyncDisabled: true/);
  assert.match(digestCronSetupPrompt, /--job digest-cron/);
  assert.match(digestCronSetupPrompt, /--regenerate "\{\{DIGEST_REGENERATE\}\}"/);
  assert.match(digestCronStopPrompt, /cron-status/);
  assert.match(digestCronStopPrompt, /--job digest-cron/);
  assert.match(digestCronStopPrompt, /--status stopped/);
  assert.match(digestCronStopPrompt, /ACCT="\$\{BUILDER_BLOG_ACCOUNT\}"/);
  assert.match(digestCronStopPrompt, /runtime-digest-cron-\$ACCOUNT_SLUG/);
  assert.match(digestCronStopPrompt, /regenerate-digest-cron-\$ACCOUNT_SLUG/);
  assert.match(digestCronStopPrompt, /tmp\/accounts\/\$ACCOUNT_SLUG\/digest-cron\/current\.json/);
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
  assert.match(libraryCronSetupPrompt, /pin the\s+scheduled runtime\/fetch settings/);
  assert.match(libraryCronSetupPrompt, /openclaw exec-policy show/);
  assert.match(libraryCronSetupPrompt, /grep -q 'ask=off'/);
  assert.match(libraryCronSetupPrompt, /Scheduled FollowBrief jobs cannot wait for approvals/);
  assert.match(libraryCronSetupPrompt, /openclaw config get agents\.defaults\.timeoutSeconds/);
  assert.match(libraryCronSetupPrompt, /openclaw config set agents\.defaults\.timeoutSeconds "\{\{CRON_TIMEOUT_SECONDS\}\}" --strict-json/);
  assert.doesNotMatch(libraryCronSetupPrompt, /exec-policy preset yolo/);
  // Pin files are per-account and per-job so multiple FollowBrief accounts and
  // job types can use different runtimes on one machine.
  assert.match(libraryCronSetupPrompt, /ACCOUNT_SLUG/);
  assert.match(libraryCronSetupPrompt, /runtime-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronSetupPrompt, /7\. Only after the initial run has passed the schedule gate above, pin the/);
  assert.match(libraryCronSetupPrompt, /crontab/);
  assert.match(libraryCronSetupPrompt, /Do not use `--force`/);
  assert.match(libraryCronSetupPrompt, /\{\{CRON_INTERVAL_MINUTES\}\}/);
  assert.doesNotMatch(libraryCronSetupPrompt, /fetchTasks/);
  // Pre-install detection: list existing same-type crons and require explicit
  // override confirmation before replacing.
  assert.match(libraryCronSetupPrompt, /com\\?\.followbrief\\?\.library\\?\./);
  assert.match(libraryCronSetupPrompt, /builder-agent-runner\\?\.sh library-cron/);
  assert.match(libraryCronSetupPrompt, /launchctl list/);
  assert.match(libraryCronSetupPrompt, /legacy_account_slug/);
  assert.match(libraryCronSetupPrompt, /grep -x "\$CANDIDATE_LABEL"/);
  assert.match(libraryCronSetupPrompt, /\[ -f "\$PLIST" \]/);
  assert.match(libraryCronSetupPrompt, /LaunchAgent plist exists/);
  assert.match(libraryCronSetupPrompt, /the user whether to\s+override/);
  assert.match(libraryCronSetupPrompt, /\(none found\)/);
  assert.match(libraryCronSetupPrompt, /SCHEDULER_PATH="\$HOME\/\.local\/bin:\$HOME\/bin:\$HOME\/\.codex\/bin:\$HOME\/\.bun\/bin:\/opt\/homebrew\/bin:\/opt\/homebrew\/sbin:\/usr\/local\/bin:\/usr\/bin:\/bin"/);
  assert.match(digestCronSetupPrompt, /SCHEDULER_PATH="\$HOME\/\.local\/bin:\$HOME\/bin:\$HOME\/\.codex\/bin:\$HOME\/\.bun\/bin:\/opt\/homebrew\/bin:\/opt\/homebrew\/sbin:\/usr\/local\/bin:\/usr\/bin:\/bin"/);
  assert.match(runner, /SCHEDULER_SAFE_PATH="\$HOME\/\.local\/bin:\$HOME\/bin:\$HOME\/\.codex\/bin:\$HOME\/\.bun\/bin:\/opt\/homebrew\/bin:\/opt\/homebrew\/sbin:\/usr\/local\/bin:\/usr\/bin:\/bin"/);
  assert.ok(
    runner.indexOf('PATH="$SCHEDULER_SAFE_PATH:$PATH"') <
      runner.indexOf('ACCOUNT_SLUG="$(account_slug "${BUILDER_BLOG_ACCOUNT:-default}")"'),
    "runner must set launchd-safe PATH before account_slug invokes node",
  );
  assert.match(runner, /runner_has_safe_bootstrap/);
  assert.match(runner, /runner_has_safe_bootstrap "\$_next"/);
  // The setup does one real initial run; cron-setup must NOT restate the
  // fetch-task execution steps.
  assert.match(
    libraryCronSetupPrompt,
    /This setup prompt only orchestrates scheduler setup/,
  );
  assert.match(
    libraryCronSetupPrompt,
    /do not manually perform\s+fetch-task work outside the numbered commands/,
  );
  assert.match(libraryCronSetupPrompt, /one real initial fetch job/);
  assert.match(libraryCronSetupPrompt, /writes fetch-log rows,[\s\S]*builders, and[\s\S]*feed items/);
  assert.match(libraryCronSetupPrompt, /do not treat a lack of\s+output as a hang/);
  assert.match(libraryCronSetupPrompt, /status: failures\.length \? "needs_confirmation" : "ok"/);
  assert.match(libraryCronSetupPrompt, /without failed post tasks[\s\S]*continue automatically to step 7/);
  assert.match(libraryCronSetupPrompt, /list every failed post\s+task[\s\S]*failed stage/);
  assert.match(libraryCronSetupPrompt, /Only\s+continue to step 7 if the user explicitly agrees/);
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
    "4. Keep the selected runtime and fetch mode scoped",
    "6. Run one real initial fetch job now",
    "BUILDER_BLOG_WORKER_MODE=1",
    "BUILDER_BLOG_JOB_TRIGGER=one_time",
    "BUILDER_BLOG_AGENT_RUNTIME=\"{{AGENT_RUNTIME}}\"",
    "BUILDER_BLOG_FETCH_DAYS=\"{{FETCH_DAYS}}\"",
    "BUILDER_BLOG_PARALLEL_WORKERS=\"{{PARALLEL_WORKERS}}\"",
    "INTERVAL_MINUTES=\"{{CRON_INTERVAL_MINUTES}}\"",
    "Report its output",
    "writes fetch-log rows",
    "After the command exits 0, run this gate",
    "needs_confirmation",
    "7. Only after the initial run has passed the schedule gate above",
    "runtime-library-cron-$ACCOUNT_SLUG",
    "schedule-anchor-library-cron-$ACCOUNT_SLUG",
    "launchctl bootstrap",
    "8. After the schedule is installed",
    "cron-status",
  ]);
  // Override-already-fetched toggle: cron-setup pins fetch-force (0/1) next to
  // the runtime, and the runner turns 1 into --force for its deterministic
  // fetch-personal command. The choice must persist on disk — a copy-time URL
  // param alone could never reach the recurring fetch.
  assert.match(libraryCronSetupPrompt, /\{\{FETCH_FORCE\}\}/);
  assert.match(libraryCronSetupPrompt, /fetch-force-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronSetupPrompt, /\{\{FETCH_DAYS\}\}/);
  assert.match(libraryCronSetupPrompt, /fetch-days-library-cron-\$ACCOUNT_SLUG/);
  assert.match(libraryCronSetupPrompt, /\$LABEL\.log/);
  assert.match(
    libraryCronSetupPrompt,
    /ACCT="\$\{BUILDER_BLOG_ACCOUNT\}"[\s\S]*account_slug\(\) \{[\s\S]*createHash[\s\S]*ACCOUNT_SLUG="\$\(account_slug "\$ACCT"\)"[\s\S]*SETUP_TMP_DIR="\$AGENT_DIR\/tmp\/accounts\/\$ACCOUNT_SLUG\/library-cron-direct"/,
  );
  assert.match(libraryCronSetupPrompt, /BUILDER_BLOG_JOB_TMP_DIR="\$SETUP_TMP_DIR"/);
  assert.match(
    libraryCronSetupPrompt,
    /ACCT="\$\{BUILDER_BLOG_ACCOUNT\}"[\s\S]*TMP_DIR="\$\{BUILDER_BLOG_JOB_TMP_DIR:-\$AGENT_DIR\/tmp\/accounts\/\$ACCOUNT_SLUG\/library-cron-direct\}"/,
  );
  assert.match(libraryCronSetupPrompt, /SCHEDULE_STATUS="\$\(cat "\$SCHEDULE_SPEC_DIR\/status\.txt"\)"/);
  assert.match(libraryCronSetupPrompt, /--started-at "\$ANCHOR_AT"/);
  assert.match(libraryCronSetupPrompt, /step after step 1 and before this check/);
  assert.match(libraryCronSetupPrompt, /This setup\s+prompt raises OpenClaw's response timeout/);
  assert.match(libraryCronSetupPrompt, /runs on this machine through the\s+selected local runtime/);
  assert.doesNotMatch(libraryCronSetupPrompt, /before step 1/);
  assert.doesNotMatch(libraryCronSetupPrompt, /do not edit that timeout by hand here/);
  assert.doesNotMatch(libraryCronSetupPrompt, /current session/);
  assert.match(digestCronSetupPrompt, /builder-agent-runner\.sh digest-cron/);
  // digest cron-setup pins the runtime too (parity with library) so the
  // scheduled job is self-sufficient even when only the digest cron is
  // installed — without the pin it falls back to the discovery chain, which
  // prompts for permissions every run.
  assert.match(digestCronSetupPrompt, /\{\{AGENT_RUNTIME\}\}/);
  assert.match(digestCronSetupPrompt, /\{\{AGENT_RUNTIME_LABEL\}\}/);
  assert.match(digestCronSetupPrompt, /pin the\s+scheduled runtime\/digest mode/);
  assert.match(digestCronSetupPrompt, /openclaw exec-policy show/);
  assert.match(digestCronSetupPrompt, /grep -q 'ask=off'/);
  assert.match(digestCronSetupPrompt, /Scheduled FollowBrief jobs cannot wait for approvals/);
  assert.match(digestCronSetupPrompt, /openclaw config get agents\.defaults\.timeoutSeconds/);
  assert.match(digestCronSetupPrompt, /openclaw config set agents\.defaults\.timeoutSeconds "\{\{CRON_TIMEOUT_SECONDS\}\}" --strict-json/);
  assert.match(digestCronSetupPrompt, /step after step 1 and before this check/);
  assert.match(digestCronSetupPrompt, /This setup\s+prompt raises OpenClaw's response timeout/);
  assert.match(digestCronSetupPrompt, /runs on this machine through the\s+selected local runtime/);
  assert.doesNotMatch(digestCronSetupPrompt, /before step 1/);
  assert.doesNotMatch(digestCronSetupPrompt, /do not edit that timeout by hand here/);
  assert.doesNotMatch(digestCronSetupPrompt, /current session/);
  assert.doesNotMatch(digestCronSetupPrompt, /exec-policy preset yolo/);
  assert.match(digestCronSetupPrompt, /ACCOUNT_SLUG/);
  assert.match(digestCronSetupPrompt, /runtime-digest-cron-\$ACCOUNT_SLUG/);
  assert.match(digestCronSetupPrompt, /schedule-anchor-digest-cron-\$ACCOUNT_SLUG/);
  assert.match(digestCronSetupPrompt, /7\. Only after the initial run has succeeded, pin the/);
  assert.match(digestCronSetupPrompt, /crontab/);
  assert.match(digestCronSetupPrompt, /\{\{CRON_INTERVAL_MINUTES\}\}/);
  // Same pre-install detection + override gate as library.
  assert.match(digestCronSetupPrompt, /com\\?\.followbrief\\?\.digest\\?\./);
  assert.match(digestCronSetupPrompt, /legacy_account_slug/);
  assert.match(digestCronSetupPrompt, /grep -x "\$CANDIDATE_LABEL"/);
  assert.match(digestCronSetupPrompt, /\[ -f "\$PLIST" \]/);
  assert.match(digestCronSetupPrompt, /LaunchAgent plist exists/);
  assert.match(digestCronSetupPrompt, /the user whether to\s+override/);
  assert.match(digestCronSetupPrompt, /\(none found\)/);
  assert.match(digestCronSetupPrompt, /\$LABEL\.log/);
  assert.match(digestCronSetupPrompt, /<key>BUILDER_BLOG_SCHEDULER_TICK<\/key><string>1<\/string>/);
  assert.match(
    digestCronSetupPrompt,
    /ACCT="\$\{BUILDER_BLOG_ACCOUNT\}"[\s\S]*account_slug\(\) \{[\s\S]*createHash[\s\S]*ACCOUNT_SLUG="\$\(account_slug "\$ACCT"\)"[\s\S]*SETUP_TMP_DIR="\$AGENT_DIR\/tmp\/accounts\/\$ACCOUNT_SLUG\/digest-cron-direct"/,
  );
  assert.match(digestCronSetupPrompt, /BUILDER_BLOG_JOB_TMP_DIR="\$SETUP_TMP_DIR"/);
  assert.match(digestCronSetupPrompt, /SCHEDULE_STATUS="\$\(cat "\$SCHEDULE_SPEC_DIR\/status\.txt"\)"/);
  assert.match(digestCronSetupPrompt, /--started-at "\$ANCHOR_AT"/);
  assert.match(digestCronPrompt, /BUILDER_BLOG_JOB_TMP_DIR/);
  assert.match(digestCronPrompt, /tmp\/accounts\/\$ACCOUNT_SLUG\/digest-cron/);
  assert.match(runner, /--context "\$_context_file"/);
  assertOrderedText(digestCronSetupPrompt, [
    "account's digest cron",
    "4. Keep the selected runtime and digest mode scoped",
    "6. Run one real initial digest job now",
    "BUILDER_BLOG_WORKER_MODE=1",
    "BUILDER_BLOG_JOB_TRIGGER=one_time",
    "BUILDER_BLOG_AGENT_RUNTIME=\"{{AGENT_RUNTIME}}\"",
    "INTERVAL_MINUTES=\"{{CRON_INTERVAL_MINUTES}}\"",
    "Report its output",
    "This is a real run",
    "7. Only after the initial run has succeeded",
    "runtime-digest-cron-$ACCOUNT_SLUG",
    "schedule-anchor-digest-cron-$ACCOUNT_SLUG",
    "launchctl bootstrap",
    "8. After the schedule is installed",
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
  assert.match(runner, /INCOMING_FETCH_FORCE_SET/);
  assert.match(runner, /INCOMING_FETCH_DAYS_SET/);
  assert.match(runner, /INCOMING_PARALLEL_WORKERS_SET/);
  assert.match(runner, /MAX_PARALLEL_WORKERS="\$INCOMING_PARALLEL_WORKERS"/);
  assert.match(runner, /DEFAULT_JOB_STATE_DIR="\$AGENT_DIR\/tmp\/accounts\/\$ACCOUNT_SLUG\/\$JOB_NAME"/);
  assert.match(runner, /DEFAULT_JOB_TMP_DIR="\$DEFAULT_JOB_STATE_DIR"/);
  assert.match(runner, /JOB_TMP_DIR="\$BUILDER_BLOG_JOB_TMP_DIR"/);
  assert.match(runner, /JOB_STATE_DIR="\$DEFAULT_JOB_STATE_DIR-direct"/);
  assert.match(runner, /BUILDER_BLOG_JOB_STATE_DIR/);
  assert.match(runner, /run_cron_worker\(\) \{[\s\S]*run_with_job_tracking "\$\{BUILDER_BLOG_JOB_TRIGGER:-scheduled\}"/);
  assert.match(runner, /job_run_update starting "Runtime job accepted by local runner\." "runtime_job_started"[\s\S]*job_run_update running "Runtime agent started\." "runtime_agent_started"/);
  assert.match(runner, /run_cron_scheduler_tick\(\)/);
  assert.match(runner, /BUILDER_BLOG_SCHEDULER_TICK/);
  assert.match(runner, /schedule-anchor-\$JOB_NAME-\$ACCOUNT_SLUG/);
  assert.match(runner, /last-fired-expected-at/);
  assert.match(runner, /BUILDER_BLOG_PROMPT_URL/);
  assert.match(runner, /BUILDER_BLOG_SMOKE_CHECK/);
  assert.match(runner, /followbriefSmokeCheck/);
  assert.match(runner, /Do not run FollowBrief fetch, digest, sync, cron-status, or setup commands/);
  assert.match(runner, /RESOLVED_INTERVAL_MINUTES/);
  assert.match(runner, /job_timeout_seconds\(\)/);
  assert.match(runner, /library-once\)[\s\S]*_timeout_interval="720"[\s\S]*_timeout_job="library-cron"/);
  assert.match(runner, /digest-once\)[\s\S]*_timeout_interval="720"[\s\S]*_timeout_job="digest-cron"/);
  assert.match(runner, /shard_timeout_seconds\(\)/);
  assert.match(runner, /digest_output_completed\(\)/);
  assert.match(runner, /Digest job did not produce required artifact/);
  assert.match(runner, /builder-blog-digest-sync-result\.json/);
  assert.match(runner, /JSON\.parse\(fs\.readFileSync\(path, "utf8"\)\)/);
  assert.match(runner, /result\?\.status === "ok"/);
  assert.match(runner, /result\?\.digest\?\.status === "SYNCED"/);
  assert.doesNotMatch(runner, /runtime output did not include a successful web sync/);
  assert.match(runner, /"SYNCED"/);
  assert.match(runner, /if \[ "\$_codex_code" -eq 0 \] && ! digest_output_completed "\$_codex_output"/);
  assert.match(runner, /local-agent-timeouts\.json/);
  assert.match(runner, /JSON\.parse\(fs\.readFileSync\(policyPath, "utf8"\)\)/);
  assert.match(runner, /Compatibility fallback/);
  assert.match(runner, /run_runtime_smoke_check\(\)[\s\S]*_timeout="\$\(job_timeout_seconds\)"/);
  assert.match(skillJobRoute, /\{\{CRON_INTERVAL_MINUTES\}\}/);
  assert.match(runner, /library-once\|digest-once\|library-cron-setup\|digest-cron-setup\|library-cron\|digest-cron/);
  assert.match(runner, /codex exec[\s\S]*--skip-git-repo-check/);
  assert.match(runner, /claude -p/);
  // openclaw 2026.5.20+ requires a session selector. Interactive runs may use
  // `--agent`, but unattended scheduled jobs use an isolated deterministic
  // Gateway session by default so they don't inherit the huge interactive main
  // session and still reuse Gateway-managed Codex OAuth.
  assert.match(runner, /openclaw_default_session_id\(\)/);
  assert.match(runner, /_openclaw_session_id="\$\{OPENCLAW_SESSION_ID:-\$\(openclaw_default_session_id\)\}"/);
  assert.match(runner, /openclaw agent --session-id "\$_openclaw_session_id" --timeout "\$_openclaw_timeout" --message/);
  assert.doesNotMatch(runner, /openclaw agent --local --session-id "\$_openclaw_session_id" --timeout "\$_openclaw_timeout" --message/);
  assert.doesNotMatch(runner, /openclaw agent --local --agent .* --timeout .* --message/);
  assert.match(runner, /openclaw_worker_prompt_file\(\)/);
  assert.match(runner, /openclaw_discovery_prompt_file\(\)/);
  assert.match(runner, /openclaw_digest_prompt_file\(\)/);
  assert.match(runner, /digest_agent_prompt_file\(\)/);
  assert.match(runner, /Gateway tool calls may not inherit the/);
  assert.match(runner, /do not search for the shard assignment or result path/);
  assert.match(runner, /export BUILDER_BLOG_SHARD_FILE=\$\(shell_quote "\$_ocp_shard_file"\)/);
  assert.match(runner, /export BUILDER_BLOG_SHARD_TIMEOUT_SECONDS=\$\(shell_quote "\$_ocp_timeout_seconds"\)/);
  assert.match(runner, /PROMPT_FILE="\$\(openclaw_worker_prompt_file "\$_slw_shard_name"/);
  assert.match(runner, /PROMPT_FILE="\$\(openclaw_discovery_prompt_file "\$_result_file"/);
  assert.match(
    runner,
    /_digest_base_prompt="\$\(digest_agent_prompt_file "\$_digest_original_prompt" "\$_context_file" "\$_agent_output_file" "\$_item_count"/,
  );
  assert.match(runner, /PROMPT_FILE="\$\(openclaw_digest_prompt_file "\$_digest_base_prompt" "\$_context_file" "\$_agent_output_file"/);
  assert.match(runner, /Candidate item count verified by the runner before this agent turn/);
  assert.match(runner, /sync_openclaw_timeout_config "\$_openclaw_timeout"/);
  assert.match(runner, /openclaw config get agents\.defaults\.timeoutSeconds/);
  assert.match(runner, /openclaw config set agents\.defaults\.timeoutSeconds "\$_seconds" --strict-json/);
  assert.match(runner, /agent_output_has_timeout/);
  assert.match(runner, /Request timed out before a response was generated/);
  assert.match(runner, /codex app-server turn idle timed out/);
  assert.match(runner, /return 124/);
  assert.match(runner, /Runtime reported a timeout/);
  assert.match(runner, /BUILDER_BLOG_AGENT_TIMEOUT_SECONDS/);
  assert.match(runner, /_timeout="\$\(job_timeout_seconds\)"/);
  assert.match(runner, /_whole_timeout="\$\(job_timeout_seconds\)"/);
  assert.doesNotMatch(runner, /timeout_seconds_for_job "\$\{INTERVAL_MINUTES:-60\}" "\$JOB_NAME"/);
  assert.match(runner, /hermes chat -q/);
  assert.doesNotMatch(runner, /gemini -p|run_with_gemini_unattended/);
  // Pinned-runtime dispatch for *-cron jobs: each runtime has an
  // _unattended variant with the matching allowlist / auto-approve
  // flags so cron never trips a permission prompt.
  assert.match(runner, /run_with_claude_unattended/);
  assert.match(runner, /run_with_codex_unattended/);
  assert.match(runner, /run_with_hermes_unattended/);
  assert.match(runner, /run_with_openclaw_unattended/);
  assert.match(runner, /hermes chat -Q --yolo --accept-hooks --source tool -q/);
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
  assert.match(runner, /\$AGENT_DIR\/\$1-\$_pin_job-\$ACCOUNT_SLUG/);
  assert.match(runner, /\$AGENT_DIR\/\$1-\$_pin_job/);
  assert.match(runner, /\$AGENT_DIR\/\$1\b/);
  assert.match(runner, /DEFAULT_JOB_TMP_DIR=/);
  assert.match(runner, /if \[ -n "\$\{BUILDER_BLOG_JOB_TMP_DIR:-\}" \]/);
  assert.match(runner, /BUILDER_BLOG_JOB_TMP_DIR/);
  assert.match(runner, /JOB_STATE_DIR/);
  assert.match(runner, /CURRENT_FILE="\$JOB_STATE_DIR\/current\.json"/);
  assert.match(runner, /JOB_TMP_DIR="\$RUNS_DIR\/\$_run_component"/);
  assert.match(runner, /\.run-owner\.json/);
  assert.match(runner, /cleanup_job_tmp_dir/);
  assert.match(runner, /cleanup_old_job_runs/);
  assert.doesNotMatch(runner, /rm -rf "\$JOB_STATE_DIR"/);
  assert.match(runner, /run_cron_supervisor/);
  assert.match(runner, /Scheduled worker running in launchd foreground/);
  assert.match(runner, /terminate_process_tree/);
  assert.match(runner, /BUILDER_BLOG_AGENT_RUNTIME/);
  assert.match(runner, /read_runtime_pin/);
  assert.match(runner, /Do not fall back from one-time jobs to cron runtime pins/);
  // Forced re-fetch: runner reads the fetch-force pin and exports
  // BUILDER_BLOG_FETCH_FORCE=--force when it's 1, then threads it into the
  // deterministic fetch-personal command.
  assert.match(runner, /fetch-force/);
  assert.match(runner, /read_pin fetch-force/);
  assert.match(runner, /BUILDER_BLOG_FETCH_FORCE="--force"/);
  assert.match(runner, /export BUILDER_BLOG_FETCH_FORCE/);
  assert.match(runner, /MAX_PARALLEL_WORKERS="\$\(read_pin parallel\)"/);
  assert.match(runner, /run_library_job/);
  assert.match(runner, /library-once\|library-cron\)[\s\S]*run_library_job/);
  assert.doesNotMatch(runner, /MAX_PARALLEL_WORKERS" -ge 2[\s\S]*run_sharded_library/);
  assert.match(runner, /followbrief-%s-%s-%s-discovery/);
  assert.match(runner, /OPENCLAW_SESSION_ID="\$\(printf 'followbrief-%s-%s-%s-%s'/);
  assert.match(cli, /if \(envAccount\)/);
  assert.match(cli, /if \(envToken\)/);
  assert.ok(
    cli.indexOf("if (envAccount)") < cli.indexOf("if (envToken)"),
    "BUILDER_BLOG_ACCOUNT must win over a bare BUILDER_BLOG_TOKEN for account isolation",
  );
  assert.match(cli, /BUILDER_BLOG_JOB_TMP_DIR/);
  assert.match(cli, /defaultDigestContextFile/);
  assert.match(cli, /defaultLibraryFetchResultFile/);
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
  assert.match(runner, /download_skill_file\(\)/);
  assert.match(runner, /mv "\$_tmp" "\$_dest"/);
  assert.match(runner, /api\/skill\/files\/builder-digest\.mjs/);
  assert.match(runner, /api\/skill\/files\/local-agent-timeouts\.json/);
  assert.doesNotMatch(
    runner,
    /curl -fsSL "\$APP_URL\/api\/skill\/files\/builder-digest\.mjs" -o "\$AGENT_DIR\/builder-digest\.mjs"/,
  );
  assert.match(bootstrapRoute, /download_skill_file\(\)/);
  assert.match(bootstrapRoute, /mv "\$_tmp" "\$_dest"/);
  assert.doesNotMatch(skillFileRoute, /builder-blog-digest\.md/);
  assert.match(skillFileRoute, /builder-blog-library-once\.md/);
  assert.match(skillFileRoute, /builder-blog-digest-once\.md/);
  assert.match(skillFileRoute, /builder-blog-library-cron-setup\.md/);
  assert.match(skillFileRoute, /builder-blog-digest-cron-setup\.md/);
  assert.doesNotMatch(skillFileRoute, /builder-blog-library-cron\.md/);
  assert.match(skillFileRoute, /builder-blog-cloud-library-host\.md/);
  assert.match(skillFileRoute, /builder-blog-digest-cron\.md/);
  assert.match(skillFileRoute, /builder-blog-library-worker\.md/);
  assert.match(skillFileRoute, /builder-blog-library-discovery\.md/);
  assert.match(skillFileRoute, /builder-agent-runner\.sh/);
  assert.match(skillFileRoute, /builder-digest\.mjs/);
  assert.match(skillFileRoute, /local-agent-timeouts\.json/);
  assert.match(skillJobFiles, /library-once/);
  assert.match(skillJobFiles, /digest-once/);
  assert.match(skillJobFiles, /cloud-library-host/);
  assert.match(skillJobFiles, /cloud-library-cron-stop/);
  assert.match(skillJobRoute, /jobSkillFiles/);
  assert.match(skillJobRoute, /text\/markdown/);
  assert.match(skillJobAliasRoute, /jobSkillFiles/);
  assert.match(skillJobAliasRoute, /rel="canonical"/);
  assert.doesNotMatch(bootstrapRoute, /api\/skill\/files\/builder-blog-digest\.md/);
  assert.match(bootstrapRoute, /api\/skill\/files\/builder-digest\.mjs/);
  assert.match(bootstrapRoute, /api\/skill\/files\/builder-agent-runner\.sh/);
  assert.match(bootstrapRoute, /api\/skill\/files\/builder-blog-cloud-library-host\.md/);
  assert.match(bootstrapRoute, /api\/skill\/files\/local-agent-timeouts\.json/);
  assert.match(bootstrapRoute, /command -v node/);
  assert.match(bootstrapRoute, /FollowBrief requires Node\.js 20 or newer/);
  assert.match(bootstrapRoute, /command -v curl/);
  assert.match(bootstrapRoute, /jobs\/library-once\.md/);
  assert.match(bootstrapRoute, /jobs\/digest-once\.md/);
  assert.match(bootstrapRoute, /jobs\/library-cron-setup\.md/);
  assert.match(bootstrapRoute, /jobs\/digest-cron-setup\.md/);
  assert.doesNotMatch(bootstrapRoute, /jobs\/library-cron\.md/);
  assert.match(bootstrapRoute, /jobs\/digest-cron\.md/);
  assert.match(bootstrapRoute, /jobs\/library-worker\.md/);
  assert.match(bootstrapRoute, /jobs\/library-discovery\.md/);
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
  assert.doesNotMatch(bootstrapRoute, /FollowBrief skill saved/);
  assert.match(runner, /node "\$AGENT_DIR\/builder-digest\.mjs" fetch-personal/);
  assert.match(runner, /node "\$AGENT_DIR\/builder-digest\.mjs" expand-discovery/);
  assert.match(runner, /node "\$AGENT_DIR\/builder-digest\.mjs" validate-agent-sync/);
  assert.match(runner, /_sps_sync_command="\$\{SYNC_BUILDERS_COMMAND:-sync-builders\}"/);
  assert.match(runner, /node "\$AGENT_DIR\/builder-digest\.mjs" "\$_sps_sync_command"/);
  assert.match(runner, /No update\. Planned 0 post tasks\./);
  assert.match(libraryDiscoveryPrompt, /candidate_discovery_fallback/);
  assert.match(libraryDiscoveryPrompt, /library-discovery-result\.json/);
  assert.match(libraryWorkerExpanded, /rawJson\.fetchTaskId/);
  assert.match(libraryWorkerExpanded, /fetchTasks/);
  assert.match(libraryWorkerExpanded, /single-post\s+`?summary`?/);
  assert.match(libraryWorkerExpanded, /summaryInstructions\.prompt/);
  assert.match(libraryWorkerExpanded, /Lifecycle vocabulary for this contract/);
  assert.match(libraryWorkerExpanded, /Read `task\.contentStatus`/);
  assert.match(libraryWorkerExpanded, /Copy `task\.builderSync` exactly/);
  assert.match(libraryWorkerExpanded, /Use `task\.minimumContentQuality`/);
  assert.match(libraryWorkerExpanded, /Build one output item/);
  assert.match(libraryWorkerExpanded, /set `body`, set `summary`/);
  assert.match(libraryWorkerExpanded, /task\.builderSync/);
  assert.match(libraryWorkerExpanded, /complete exactly\s+the task IDs returned by the CLI/i);
  assert.match(libraryWorkerExpanded, /Do not add new sources, URLs, or feed items/);
  assert.match(libraryWorkerExpanded, /[Dd]o not stop\s+just because one extraction method fails/);
  assert.match(runner, /builder-blog-library-worker\.md/);
  assert.match(runner, /builder-blog-library-discovery\.md/);
  assert.doesNotMatch(digestCronPrompt, /builder-digest\.mjs" prepare/);
  assert.match(runner, /builder-digest\.mjs" prepare \$\{BUILDER_BLOG_DIGEST_REGENERATE:-\}/);
  assert.doesNotMatch(digestCronPrompt, /prepare --days/);
  assert.doesNotMatch(digestCronPrompt, /builder-blog-digest\.json/);
  assert.doesNotMatch(digestCronPrompt, /builder-blog-digest\.md/);
  assert.match(digestCronPrompt, /Read only `\$TMP_DIR\/builder-blog-context\.json`/);
  assert.match(digestCronPrompt, /Write only `\$TMP_DIR\/builder-blog-digest-agent-output\.json`/);
  assert.doesNotMatch(digestCronPrompt, /Do not change paths/);
  assert.doesNotMatch(digestCronPrompt, /cadence|titles|success criteria/);
  assert.doesNotMatch(digestCronPrompt, /lower-level digest/);
  assert.doesNotMatch(digestCronPrompt, /cron-status|bootstrap|schedule commands/);
  assert.match(digestCronExpanded, /summary JSON/);
  assert.doesNotMatch(digestCronPrompt, /api\/skill\/bootstrap/);
  assert.doesNotMatch(digestCronPrompt, /runner already downloaded the latest skill files/);
  // The recurring run shares the once job's structured output contract via the
  // partial.
  assert.match(digestCronPrompt, /\{\{INCLUDE:digest-task-contract TMP_JOB="digest-cron"\}\}/);
  assert.doesNotMatch(digestCronExpanded, /\{\{INCLUDE|\{\{TMP_JOB\}\}/);
  assert.match(digestCronExpanded, /builder-blog-digest-agent-output\.json/);
  assert.match(digestCronExpanded, /context\.digest\.headlinePrompt/);
  assert.match(digestCronExpanded, /1200 characters or fewer/);
  assert.match(digestCronExpanded, /Source A and Source B/);
  assert.match(digestCronExpanded, /runner invokes this contract only after it has already verified/);
  assert.doesNotMatch(digestCronExpanded, /Do not write a no-updates digest JSON/);
  assert.match(digestCronExpanded, /reopen[\s\S]*builder-blog-digest-agent-output\.json[\s\S]*self-check/);
  assert.match(digestCronExpanded, /context\.digest\.perSourceSummaryPrompt/);
  // Post summaries are copied verbatim by the CLI now — the agent must not
  // rewrite or translate them, so the prompt drops context.digest.translate.
  assert.match(digestCronExpanded, /Do not write per-post summaries/);
  assert.match(digestCronExpanded, /into the digest verbatim/);
  assert.doesNotMatch(digestCronExpanded, /context\.digest\.translate/);
  assert.doesNotMatch(digestCronExpanded, /context\.digest\.digestIntro/);
  assert.doesNotMatch(digestCronPrompt, /builder-digest\.mjs" prepare/);
  assert.doesNotMatch(digestCronPrompt, /render-digest/);
  assert.doesNotMatch(digestCronPrompt, /builder-digest\.mjs" sync/);
  assert.doesNotMatch(digestCronPrompt, /The FollowBrief runner owns candidate preparation/);
  assert.match(digestCronExpanded, /headlineSummary/);
  assert.match(runner, /run_digest_job\(\)/);
  assert.match(runner, /builder-digest\.mjs" prepare/);
  assert.match(runner, /digest_context_item_count/);
  assert.match(runner, /BUILDER_BLOG_DIGEST_AGENT_ONLY=1/);
  assert.match(runner, /builder-digest\.mjs" render-digest/);
  assert.match(runner, /builder-digest\.mjs" sync/);
  assert.match(runner, /No update\. Prepared 0 candidates\./);
  assert.doesNotMatch(digestCronExpanded, /summarize-tweets\.md/);
  assert.doesNotMatch(digestCronExpanded, /context\.prompts/);
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

test("vercel migration wrapper blocks schema drift unless explicitly bypassed", () => {
  const migrate = readFileSync("scripts/vercel-migrate.mjs", "utf8");
  assert.match(migrate, /VERCEL_MIGRATE_ALLOW_CONNECTIVITY_SKIP/);
  assert.match(migrate, /process\.exit\(1\)/);
  assert.doesNotMatch(migrate, /Continuing the build anyway/);
});

test("digest sync user path requires structured digest items and derives digested marks", () => {
  const parsed = parseSkillDigestPayload({
    title: "Personal YouTube Builder Digest",
    items: [
      {
        order: 0,
        section: { key: "blog", label: "Blog", sourceType: "blog" },
        source: {
          entityId: "e1",
          name: "Example Blog",
          sourceType: "blog",
          sourceUrl: "https://example.com",
          fetchUrl: null,
        },
        sourceSummary: "Example Blog published a product note.",
        post: {
          feedItemId: "fi1",
          entityId: "e1",
          kind: "BLOG_POST",
          externalId: "x1",
          title: "Post title",
          url: "https://example.com/post",
          sourceName: "Example Blog",
          sourceType: "blog",
          publishedAt: "2026-06-20T10:00:00.000Z",
          createdAt: "2026-06-20T10:05:00.000Z",
        },
        summary: "Digest summary.",
      },
    ],
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.language, "zh");
  assert.equal(parsed.data.itemCount, 0);
  assert.equal(parsed.data.headlineSummary, undefined);
  assert.equal(parsed.data.regenerate, false);
  assert.equal(parsed.data.items.length, 1);
  assert.equal(parsed.data.items[0].post.feedItemId, "fi1");

  const withStructuredMarks = parseSkillDigestPayload({
    title: "Digest",
    regenerate: true,
    items: parsed.data.items,
  });
  assert.equal(withStructuredMarks.success, true);
  if (withStructuredMarks.success) {
    assert.equal(withStructuredMarks.data.regenerate, true);
    assert.equal(withStructuredMarks.data.items[0].post.entityId, "e1");
  }

  const withHeadlineSummary = parseSkillDigestPayload({
    title: "Digest",
    items: parsed.data.items,
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
    items: parsed.data.items,
    headlineSummary: "x".repeat(1201),
  });
  assert.equal(tooLongHeadlineSummary.success, false);

  const empty = parseSkillDigestPayload({ title: "Bad", items: [] });
  assert.equal(empty.success, false);

  const markdownOnly = parseSkillDigestPayload({ title: "Bad", content: "Digest body" });
  assert.equal(markdownOnly.success, false);
});

test("fetch task success requires a persisted summary; failures are recorded with a reason", () => {
  // Server is the authoritative gate: a no-summary item is a recorded FAILURE
  // (with reason), not a silent skip, and per-task results come back to the CLI.
  const buildersRoute = readFileSync("src/app/api/skill/builders/route.ts", "utf8");
  const feedSync = readFileSync("src/lib/builder-feed-sync.ts", "utf8");
  assert.match(feedSync, /isAdminFetchOnlySourceType\(input\.sourceType\)/);
  assert.match(feedSync, /reason: "admin_fetch_only_source"/);
  assert.match(buildersRoute, /itemResults/);
  assert.match(feedSync, /reason: "summary_missing"/);
  assert.match(feedSync, /status: "failed"/);
  assert.match(buildersRoute, /readFetchTaskId/);
  // Body / crawled-content gate: a post with no real content is also a recorded
  // failure server-side (not just client-side validate), symmetric with summary.
  assert.match(feedSync, /checkBodyContentQuality/);
  assert.match(feedSync, /contentVerdict/);

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
    "skills/builder-blog-digest/jobs/_fetch-task-syncing.md",
    "utf8",
  );
  assert.match(contract, /complete ONLY when its local sync item has real crawled content/);
  assert.match(contract, /source-specific raw retention/);
  assert.match(contract, /FAILURE/);
});

test("skill builder sync accepts durable fetch-run patches with long task ids", () => {
  const longFetchTaskId = `fetch_post:blog:${"a".repeat(420)}`;
  const parsed = parseSkillBuilderSyncPayload({
    force: true,
    builders: [
      {
        builderId: "builder_blog_1",
        kind: "BLOG",
        sourceType: "blog",
        name: "Engineering",
        sourceUrl: "https://example.com/engineering",
        fetchUrl: "https://example.com/engineering",
        subscribe: true,
        items: [
          {
            kind: "BLOG_POST",
            externalId: "long-id-post",
            title: "Long id post",
            body: "A real body long enough for the sync contract.",
            summary: "A real summary for a task with a long fetch id.",
            url: "https://example.com/engineering/long-id-post",
            publishedAt: "2026-05-22T10:00:00.000Z",
            rawJson: { fetchTaskId: longFetchTaskId },
          },
        ],
      },
    ],
    taskOutcomes: [
      {
        fetchTaskId: longFetchTaskId,
        status: "failed",
        reason: "worker_missing_result",
      },
    ],
    fetchRun: {
      id: "fetch_run_1",
      plannedTasks: [
        {
          id: longFetchTaskId,
          builderId: "builder_blog_1",
          builder: "Engineering",
          sourceType: "blog",
          title: "Long id post",
          url: "https://example.com/engineering/long-id-post",
        },
      ],
    },
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.fetchRun?.id, "fetch_run_1");
  assert.equal(parsed.data.fetchRun?.plannedTasks[0]?.id, longFetchTaskId);
  assert.equal(parsed.data.taskOutcomes[0]?.fetchTaskId, longFetchTaskId);
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
  assert.match(panel, /Skipped: no content/);
  assert.doesNotMatch(panel, /Skipped — no content/);
  assert.match(panel, /formatEvidence/);

  // Contract forbids cross-task generalization / blanket skips. The rule
  // spans the per-task core and the validate/sync tail, so assert on both.
  const contract = [
    readFileSync("skills/builder-blog-digest/jobs/_fetch-task-core.md", "utf8"),
    readFileSync("skills/builder-blog-digest/jobs/_fetch-task-syncing.md", "utf8"),
  ].join("\n");
  assert.match(contract, /NEVER infer one task's content/);
  assert.match(contract, /per-task evidence/);
  assert.match(contract, /taskOutcomes/);

  // YouTube extraction strategy moved out of the contract into the source prompt.
  assert.doesNotMatch(contract, /silent screen recording/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchYouTubeTranscript, /Only if no usable captions\/transcript are available/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchYouTubeTranscript, /Prefer faster-whisper or MLX Whisper/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchYouTubeTranscript, /Do not use the OpenAI API/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.fetchYouTubeTranscript, /estimate this\s+video's duration/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.fetchYouTubeTranscript, /local_asr_duration_exceeded/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.fetchYouTubeTranscript, /worker budget/);
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
  // time window. Override (regenerate) re-includes posts already used in AI Digest.
  const contextRoute = readFileSync("src/app/api/skill/context/route.ts", "utf8");
  assert.match(contextRoute, /publishedAfter: lookbackCutoff/);
  assert.match(contextRoute, /digestCandidateLimitForLastRun\(now, lastDigest\?\.createdAt\)/);
  assert.match(contextRoute, /limit: digestCandidateLimit/);
  assert.doesNotMatch(contextRoute, /limit: 80/);
  assert.match(contextRoute, /candidateLimit: digestCandidateLimit/);
  assert.match(contextRoute, /excludeDigestedForUserId: regenerate \? null : user\.id/);
  assert.match(contextRoute, /isAdminFetchOnlySourceType\(builder\.sourceType\)/);
  assert.match(contextRoute, /!userIsAdmin/);
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
  assert.match(digestCreateRoute, /catch \(error\)/);
  assert.match(digestCreateRoute, /console\.error\("Digest sync failed"/);
  assert.match(digestCreateRoute, /Digest sync failed/);
  assert.match(digestCreateRoute, /DIGEST_SYNC_TRANSACTION_OPTIONS/);
  assert.match(digestCreateRoute, /timeout:\s*30_000/);

  // The CLI reads candidates from the prepared context file and sends them.
  const cli = readFileSync("scripts/builder-digest.mjs", "utf8");
  // Each caller declares its intent so the shared context endpoint does only its
  // own work: digest prepare records a DigestRun + computes candidates; library
  // fetch does neither.
  assert.match(cli, /api\/skill\/context\?intent=digest/);
  assert.match(cli, /source=\$\{encodeURIComponent\(runSource\)\}/);
  assert.match(cli, /jobRunId=\$\{encodeURIComponent\(envJobRunId\(\)\)\}/);
  assert.match(cli, /typeof ctx\.jobRunId === "string"/);
  assert.doesNotMatch(cli, /includePrompts=1/);
  assert.match(cli, /api\/skill\/context\?intent=library&days=/);
  assert.match(cli, /digestedItems/);
  assert.match(cli, /\.\.\.\(runId \? \{ runId \} : \{\}\)/);
  assert.match(cli, /\.\.\.\(jobRunId \? \{ jobRunId \} : \{\}\)/);
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
    avatarUrl: null,
    avatarDataUrl: null,
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
  assert.ok(relevant.reasons.includes("from a followed source"));
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
      "fetchYouTubeTranscript",
      "headline",
      "perSourceSummary",
      "summarizeBlogs",
      "summarizeGithubTrendingRepo",
      "summarizePodcast",
      "summarizeProductHuntTopProduct",
      "summarizeTweets",
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
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /structured extraction, not open-ended product/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /Official-site evidence:/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /Not visible:/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /Do not use general web search/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /Product Hunt itself links directly to them as the product's official site/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /3\. Explain what the product concretely does/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /4\. Explain why it is noteworthy/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /5\. If a field is hidden/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /Use the product's official website and web search/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.fetchProductHuntTopProduct, /Hacker News, Reddit/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchYouTubeTranscript, /creator\/manual captions/);
  assert.match(DEFAULT_DIGEST_PROMPTS.fetchYouTubeTranscript, /Do not use the OpenAI API/);
  assert.match(
    DEFAULT_DIGEST_PROMPTS.summarizeProductHuntTopProduct,
    /user-selected output language/,
  );
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizeProductHuntTopProduct, /mobile-friendly digest card/);
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizeProductHuntTopProduct, /two short paragraphs/);
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizeProductHuntTopProduct, /Do not output field labels/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.summarizeProductHuntTopProduct, /\nProduct name:\n/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.summarizeProductHuntTopProduct, /\nWhat the product does:\n/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.summarizeProductHuntTopProduct, /Chinese|项目名称/);
  assert.match(DEFAULT_DIGEST_PROMPTS.digestIntro, /Legacy Digest Intro Prompt/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /headlineSummary/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /context\.language/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /Prefer one line per/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /Source name: one sentence summary/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /Source A and Source B: one sentence summary/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /same source order/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /50 characters or fewer/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /1200 characters or fewer/);
  assert.match(DEFAULT_DIGEST_PROMPTS.headline, /shorten or merge lines until it fits/);
  assert.doesNotMatch(DEFAULT_DIGEST_PROMPTS.headline, /Chinese characters|Mandarin|simplified Chinese/i);
  assert.match(DEFAULT_DIGEST_PROMPTS.perSourceSummary, /exactly one source/);
  assert.match(DEFAULT_DIGEST_PROMPTS.perSourceSummary, /output an empty string/);
  assert.match(DEFAULT_DIGEST_PROMPTS.perSourceSummary, /context\.language/);
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
  assert.match(userSearch, /pipeline=\$\{pipeline\.id\}&digest=\$\{digest\.id\}/);
  assert.match(userSearch, /tab=ai-digest&digest=\$\{digest\.id\}/);
  assert.doesNotMatch(userSearch, /dashboard\?tab=ai-digest[^`]*#\$\{digest\.id\}/);
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
        body: "Vector recall over fetched posts and the AI Digest issue.",
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
  assert.equal(parseSearchQuery("agent memory type:ai-digest-issue").type, "digest");
  assert.equal(parseSearchQuery("agent memory -type:ai-digest-issues").excludedTypes[0], "digest");
  assert.equal(parseSearchQuery("agent memory type:ai-digest-archive").type, "digest");
  assert.equal(parseSearchQuery("agent memory -type:ai-digest-archives").excludedTypes[0], "digest");
  assert.deepEqual(parseSearchQuery("agent memory -type:sources").excludedTypes, ["builder"]);
  assert.equal(searchDocumentTypeParamValue("builder"), "source");
  assert.equal(searchDocumentTypeParamValue("feed"), "post");
  assert.equal(searchDocumentTypeParamValue("digest"), "ai-digest");
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
  assert.equal(builderLibraryList.includes("builder-library-source-section"), false);
  assert.equal(builderLibraryList.includes("builder-library-source-list"), true);
  // UI copy stays away from "fetched" inside the library row; the canonical
  // display component is PostCard, while fetched-post-* classes still use
  // "fetched" because the storage layer is still the FeedItem fetch path.
  assert.equal(builderLibraryList.includes('className="builder-posts-count"'), true);
  assert.equal(
    builderLibraryList.includes(
      'const postCountLabel = `${builder.feedItemCount} ${',
    ),
    true,
  );
  assert.equal(builderLibraryList.includes("aria-label={postsSummaryLabel}"), true);
  assert.equal(builderFeedItems.includes("formatPostDate"), false);
  assert.equal(builderFeedItems.includes("PostCard"), true);
  assert.equal(builderFeedItems.includes("showBuilderRow={false}"), true);
  assert.equal(builderFeedItems.includes("showSourceBadge={false}"), true);
  assert.equal(readFileSync("src/components/PostCardView.tsx", "utf8").includes("Original content"), true);
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
    "Blog / Article Feed",
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

test("digest headline default migration covers length and combined sources", () => {
  const migration = readFileSync(
    "prisma/migrations/000065_digest_headline_length_and_merge/migration.sql",
    "utf8",
  );

  assert.match(migration, /UPDATE "DigestConfig"[\s\S]*"headlinePrompt"/);
  assert.match(migration, /UPDATE "UserDigestConfig"[\s\S]*"headlinePrompt"/);
  assert.match(migration, /1200 characters or fewer/);
  assert.match(migration, /Source A and Source B: one sentence summary/);
  assert.match(migration, /WHERE "headlinePrompt" = '# Digest Headline Prompt/);
  assert.doesNotMatch(migration, /WHERE "headlinePrompt" LIKE/);
});

test("Product Hunt summary prompt migration removes label-value card output", () => {
  const migration = readFileSync(
    "prisma/migrations/000066_product_hunt_mobile_summary_prompt/migration.sql",
    "utf8",
  );

  assert.match(migration, /UPDATE "SourceTypeConfig"[\s\S]*"sourceId" = 'product_hunt_top_products'/);
  assert.match(migration, /UPDATE "UserSourceTypeConfig"[\s\S]*"sourceId" = 'product_hunt_top_products'/);
  assert.match(migration, /mobile-friendly digest card summary/);
  assert.match(migration, /Do not output field labels/);
  assert.match(migration, /WHERE "sourceId" = 'product_hunt_top_products'\s+AND "summaryPromptBody" = \$\$# Product Hunt Top Product Summary Prompt/);
  assert.match(migration, /Product name:/);
  assert.match(migration, /What the product does:/);
});

test("Product Hunt fetch prompt migration removes the general web search ban from user prompts", () => {
  const migration = readFileSync(
    "prisma/migrations/000071_product_hunt_fetch_prompt_remove_web_search_ban/migration.sql",
    "utf8",
  );

  assert.match(migration, /UPDATE "SourceTypeConfig"[\s\S]*"sourceId" = 'product_hunt_top_products'/);
  assert.match(migration, /UPDATE "UserSourceTypeConfig"[\s\S]*"sourceId" = 'product_hunt_top_products'/);
  assert.match(migration, /replace\([\s\S]*Do not use general web search/);
  assert.match(migration, /Product Hunt itself links directly to them as the product's official site/);
  assert.match(migration, /\$\$4\. Explain what the product concretely does[\s\S]*\$\$3\. Explain what the product concretely does/);
  assert.match(migration, /\$\$5\. Explain why it is noteworthy[\s\S]*\$\$4\. Explain why it is noteworthy/);
  assert.match(migration, /\$\$6\. If a field is hidden[\s\S]*\$\$5\. If a field is hidden/);
});

test("YouTube fetch prompt migration reverts agent-side ASR duration guessing", () => {
  const migration = readFileSync(
    "prisma/migrations/000075_revert_youtube_asr_budget_prompt/migration.sql",
    "utf8",
  );

  assert.match(migration, /UPDATE "SourceTypeConfig"[\s\S]*"sourceId" = 'youtube'/);
  assert.match(migration, /UPDATE "UserSourceTypeConfig"[\s\S]*"sourceId" = 'youtube'/);
  assert.match(migration, /Prefer faster-whisper or MLX Whisper/);
  assert.match(migration, /local_asr_duration_exceeded/);
  assert.match(migration, /worker budget/);
  assert.doesNotMatch(migration, /estimate this\s+video's duration/);
  assert.doesNotMatch(migration, /Before starting local speech transcription/);
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
  assert.match(digestRoute, /Headline and per-source digest prompts can only be changed by an admin/);
  assert.match(digestRoute, /commonFetchRules: defaultConfig\.commonFetchRules/);
  assert.match(digestRoute, /commonSummaryRules: defaultConfig\.commonSummaryRules/);
  assert.match(digestRoute, /updateUserDigestConfigAndDefault/);
  const digestPromptMigration = readFileSync(
    "prisma/migrations/000067_digest_post_summary_prompt_limits/migration.sql",
    "utf8",
  );
  assert.match(digestPromptMigration, /UPDATE "DigestConfig"/);
  assert.match(digestPromptMigration, /UPDATE "UserDigestConfig"/);
  assert.match(digestPromptMigration, /admin_emails/);
  assert.match(digestPromptMigration, /500 words or fewer/);
  assert.match(digestPromptMigration, /key points, viewpoints, insights/);
  assert.doesNotMatch(digestPromptMigration, /Maintain the same structure and formatting as the source digest/);
  assert.match(store, /client\(\)\.\$transaction\(/);
  assert.equal(DEFAULT_SOURCE_CONFIGS.github_trending.defaultFetchLimit, 3);
  assert.equal(DEFAULT_SOURCE_CONFIGS.product_hunt_top_products.defaultFetchLimit, 3);
  assert.equal(DEFAULT_SOURCE_CONFIGS.github_trending.defaultFetchDays, 30);
  assert.equal(DEFAULT_SOURCE_CONFIGS.product_hunt_top_products.defaultFetchDays, 30);

  // Settings page shows source/digest config to every user, but only admins can
  // edit the common fetching and post-summary rules shared defaults.
  const settingsPage = readFileSync("src/app/(workspace)/settings/page.tsx", "utf8");
  assert.match(settingsPage, /where: \{ userId, revokedAt: null \}/);
  assert.match(settingsPage, /getUserSourceConfigs\(userId\)/);
  assert.match(settingsPage, /getAllSourceConfigs\(\)/);
  assert.match(settingsPage, /canEditQualityGates=\{isAdmin\}/);
  assert.match(settingsPage, /getUserDigestConfig\(userId\)/);
  assert.doesNotMatch(settingsPage, /Source and digest rules/);
  assert.match(settingsPage, /Source fetching rules/);
  assert.doesNotMatch(settingsPage, /Source fetch rules/);
  assert.match(settingsPage, /AI Digest rules/);
  assert.doesNotMatch(settingsPage, />Digest rules</);
  assert.match(settingsPage, /CommonFetchRulesForm/);
  assert.match(settingsPage, /CommonSummaryRulesForm/);
  assert.match(settingsPage, /isAdminEmail\(session\.user\.email\)/);
  assert.match(settingsPage, /isAdmin \?/);
  assert.match(settingsPage, /USER_DIGEST_PROMPT_COUNT/);
  assert.match(settingsPage, /canEditDigestAssemblyPrompts=\{isAdmin\}/);
  // The cloud-fetch config form now lives on the Cloud library management page;
  // Settings only keeps a pointer section to it.
  assert.doesNotMatch(settingsPage, /AdminCloudFetchConfigForm/);
  assert.match(settingsPage, /\{isAdmin \? <AdminCloudFetchConfigSection \/> : null\}/);

  // Runtime reads resolve source and digest assembly rules to the requesting
  // user's config, but common fetching and post-summary rules always come from
  // the default template admin edits.
  const contextRoute = readFileSync("src/app/api/skill/context/route.ts", "utf8");
  assert.match(contextRoute, /getUserSourceConfigs\(user\.id\)/);
  assert.match(contextRoute, /getAllSourceConfigs\(\)/);
  assert.match(contextRoute, /contentQuality: defaultSourceConfigById\.get\(def\.id\)\?\.contentQuality/);
  assert.match(contextRoute, /sourceType: it\.builder\?\.sourceType \?\? null/);
  assert.match(contextRoute, /getUserDigestConfig\(user\.id\)/);
  assert.match(contextRoute, /getDigestConfig\(\)/);
  assert.match(contextRoute, /commonFetchRules: defaultDigestConfig\.commonFetchRules/);
  assert.match(contextRoute, /commonSummaryRules: defaultDigestConfig\.commonSummaryRules/);
  const feedSync = readFileSync("src/lib/builder-feed-sync.ts", "utf8");
  assert.match(feedSync, /getAllSourceConfigs\(\)/);
  assert.doesNotMatch(feedSync, /getUserSourceConfigs\(user\.id\)/);

  // The editing components post to the per-user endpoints.
  const srcManager = readFileSync("src/components/AdminSourceTypeManager.tsx", "utf8");
  const digestForm = readFileSync("src/components/AdminDigestConfigForm.tsx", "utf8");
  const commonSummaryRulesForm = readFileSync("src/components/CommonSummaryRulesForm.tsx", "utf8");
  assert.match(srcManager, /\/api\/settings\/source-types/);
  assert.match(srcManager, /canEditQualityGates/);
  assert.match(srcManager, /patch\.contentQuality = contentQuality/);
  assert.match(digestForm, /\/api\/settings\/digest-config/);
  assert.doesNotMatch(digestForm, /Section/);
  assert.doesNotMatch(digestForm, /AI Digest prompts/);
  assert.doesNotMatch(digestForm, /Prompts used to generate AI Digest\./);
  assert.doesNotMatch(digestForm, /Prompts used after posts already have per-post summaries\./);
  assert.match(digestForm, /Writes the headline summary in the selected language/);
  assert.doesNotMatch(digestForm, /selected AI Digest language/);
  // The per-post "translate" prompt field is gone; post summaries are copied
  // verbatim by the CLI, so the form no longer exposes a post-summary prompt.
  assert.doesNotMatch(digestForm, /Post summary prompt/);
  assert.doesNotMatch(digestForm, /Writes post summaries in the selected language/);
  assert.doesNotMatch(digestForm, /draft\.translate/);
  assert.match(digestForm, /Headline prompt cannot be empty\./);
  assert.match(digestForm, /canEditDigestAssemblyPrompts/);
  assert.match(digestForm, /draft\.perSourceSummaryPrompt\.trim\(\)\.length === 0 \? "" : draft\.perSourceSummaryPrompt/);
  assert.match(digestForm, /Could not save AI Digest rules\./);
  assert.doesNotMatch(digestForm, /title="Digest prompts"|selected digest language|label="Translate prompt"|ariaLabel="Translate prompt"/);
  assert.doesNotMatch(digestForm, /Save failed/);
  assert.doesNotMatch(digestForm, /OrderedChoiceField/);
  assert.doesNotMatch(digestForm, /knownSourceIds/);
  assert.doesNotMatch(digestForm, /digestOrder/);
  assert.doesNotMatch(settingsPage, /knownSourceIds/);
  assert.match(commonSummaryRulesForm, /commonFetchRules/);
  assert.match(commonSummaryRulesForm, /Could not save \$\{title\.toLowerCase\(\)\}\./);
  assert.match(commonSummaryRulesForm, /Common summary rules cannot be empty\./);
  assert.match(commonSummaryRulesForm, /Common fetching rules cannot be empty\./);
  assert.doesNotMatch(commonSummaryRulesForm, /can't be empty/);
  assert.doesNotMatch(commonSummaryRulesForm, /Save failed/);
  assert.match(commonSummaryRulesForm, /commonSummaryRules/);
  assert.match(commonSummaryRulesForm, /\/api\/settings\/digest-config/);
  assert.doesNotMatch(digestForm, /commonSummaryRules/);
  const digestConfigRoute = readFileSync("src/app/api/settings/digest-config/route.ts", "utf8");
  assert.match(digestConfigRoute, /perSourceSummaryPrompt: z\.string\(\)\.max\(20_000\)\.optional\(\)/);

  // Config is no longer described as admin-owned in the agent contract / CLI.
  const contract = readFileSync(
    "skills/builder-blog-digest/jobs/_fetch-task-core.md",
    "utf8",
  );
  assert.match(contract, /common fetching rules plus your per-source fetch prompt/);
  assert.doesNotMatch(contract, /context\.digest\.order/);
  assert.doesNotMatch(contract, /the admin's per-source fetch prompt/);
});
