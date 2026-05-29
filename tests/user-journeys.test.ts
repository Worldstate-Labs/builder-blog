import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BuilderKind, DigestFrequency, FeedItemKind } from "@prisma/client";
import { isAdminEmail } from "../src/lib/admin";
import {
  builderLibraryKey,
  canonicalBuilderKey,
  canonicalBuilderValueForInput,
  normalizeHandle,
} from "../src/lib/builder-keys";
import { subscriptionBuilderIdsInPool } from "../src/lib/digest-library";
import { DEFAULT_DIGEST_PROMPTS } from "../src/lib/digest-prompts";
import {
  digestFallbackSince,
  digestFrequencyDays,
  digestMaxAgeCutoff,
  digestMaxPostAgeDays,
} from "../src/lib/feed-preferences";
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

test("subscription user path is a digest subset of the active builder pool", () => {
  assert.deepEqual(
    subscriptionBuilderIdsInPool(
      ["central_openai", "personal_youtube"],
      ["personal_youtube", "removed_builder", "central_openai"],
    ),
    ["personal_youtube", "central_openai"],
  );
});

test("non-admin users default-import the admin community library", () => {
  const builderPool = readFileSync("src/lib/builder-pool.ts", "utf8");
  const buildersPage = readFileSync("src/app/(workspace)/builders/page.tsx", "utf8");
  const hubPage = readFileSync("src/app/(workspace)/library-hub/page.tsx", "utf8");
  const hubImportRoute = readFileSync("src/app/api/library-hub/imports/route.ts", "utf8");
  const libraryHub = readFileSync("src/lib/library-hub.ts", "utf8");

  assert.match(builderPool, /activePoolBuilderIds/);
  assert.match(builderPool, /ensureDefaultCommunityLibraryImport\(userId\)/);
  assert.match(builderPool, /if \(!user \|\| isAdminEmail\(user\.email\)\)/);
  assert.match(builderPool, /userLibraryVisibility/);
  assert.match(builderPool, /isFeatured:\s*true/);
  assert.match(builderPool, /BuilderPoolOrigin\.HUB_IMPORT/);
  assert.match(builderPool, /libraryImport\.create/);
  assert.match(libraryHub, /removeLibraryImportFromHub/);
  assert.match(libraryHub, /reachability\.survivingEntityIds/);
  assert.match(libraryHub, /removableBuilderIds/);
  assert.match(libraryHub, /hidden: true/);
  assert.match(libraryHub, /setLibraryHidden/);
  assert.match(hubImportRoute, /export async function DELETE/);
  assert.match(buildersPage, /ensureDefaultCommunityLibraryImport\(session\.user\.id\)/);
  assert.match(hubPage, /ensureDefaultCommunityLibraryImport\(session\.user\.id\)/);
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
  const digestCronSetupPrompt = readFileSync("skills/builder-blog-digest/jobs/digest-cron-setup.md", "utf8");
  const libraryCronPrompt = readFileSync("skills/builder-blog-digest/jobs/library-cron.md", "utf8");
  const digestCronPrompt = readFileSync("skills/builder-blog-digest/jobs/digest-cron.md", "utf8");

  assert.doesNotMatch(settingsPanel, /Copy setup command/);
  // The bootstrap curl block was intentionally removed from
  // AgentTokenPanel — users now copy the setup prompt from
  // SkillPromptActions, which references the bootstrap route directly.
  assert.doesNotMatch(settingsPanel, /\/api\/skill\/bootstrap/);
  assert.match(buildersPage, /<SkillPromptActions context="library"/);
  assert.match(dashboardPage, /<SkillPromptActions context="digest"/);
  assert.match(skillPromptActions, /Source sync/);
  assert.match(skillPromptActions, /Digest sync/);
  assert.match(skillPromptActions, /Copy once prompt/);
  assert.match(skillPromptActions, /Copy cron prompt/);
  assert.match(skillPromptActions, /Read \$\{promptUrl\} and follow the instructions/);
  assert.match(skillPromptActions, /\/api\/skill\/jobs\/\$\{job\}\/skill\.md/);
  // Cron copy flow picks runtime AND cadence, both passed as URL params.
  assert.match(skillPromptActions, /CronConfigDialog/);
  assert.match(skillPromptActions, /FREQUENCY_OPTIONS/);
  assert.match(skillPromptActions, /params\.set\("runtime"/);
  assert.match(skillPromptActions, /params\.set\("freq"/);
  assert.match(skillPromptActions, /Frequency/);
  // Server validates freq against a whitelist → fixed cron expression and
  // substitutes the schedule + cadence label into the cron-setup prompt.
  assert.match(skillJobRoute, /cronSchedules/);
  assert.match(skillJobRoute, /searchParams\.get\("freq"\)/);
  assert.match(skillJobRoute, /\{\{CRON_SCHEDULE\}\}/);
  assert.match(skillJobRoute, /\{\{CRON_FREQUENCY_LABEL\}\}/);
  // macOS scheduling uses a launchd LaunchAgent (keychain access); the route
  // provides a launchd schedule fragment per cadence.
  assert.match(skillJobRoute, /launchdSchedules/);
  assert.match(skillJobRoute, /\{\{LAUNCHD_SCHEDULE\}\}/);
  // cron-setup prompts use the placeholders, not a hard-coded schedule, and
  // install via launchd on macOS / crontab on Linux.
  assert.match(libraryCronSetupPrompt, /\{\{CRON_SCHEDULE\}\}/);
  assert.match(libraryCronSetupPrompt, /\{\{CRON_FREQUENCY_LABEL\}\}/);
  assert.match(libraryCronSetupPrompt, /\{\{LAUNCHD_SCHEDULE\}\}/);
  assert.match(libraryCronSetupPrompt, /launchctl bootstrap/);
  assert.match(libraryCronSetupPrompt, /LaunchAgents/);
  assert.doesNotMatch(libraryCronSetupPrompt, /0 \*\/6 \* \* \*/);
  assert.match(digestCronSetupPrompt, /\{\{CRON_SCHEDULE\}\}/);
  assert.match(digestCronSetupPrompt, /\{\{LAUNCHD_SCHEDULE\}\}/);
  assert.match(digestCronSetupPrompt, /launchctl bootstrap/);
  assert.doesNotMatch(digestCronSetupPrompt, /0 8 \* \* \*/);
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
  function expandIncludes(content: string): string {
    return content.replace(
      /\{\{INCLUDE:fetch-task-contract REPORT_TARGET="([^"]*)"\}\}/g,
      (_m, target) =>
        fetchTaskContract
          .replace(/^\s*<!--[\s\S]*?-->\s*/, "")
          .replaceAll("{{REPORT_TARGET}}", target)
          .trim(),
    );
  }
  const libraryOnceExpanded = expandIncludes(libraryOncePrompt);
  const libraryCronExpanded = expandIncludes(libraryCronPrompt);

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
  assert.match(libraryOnceExpanded, /fetch-personal --days 30 --limit 3/);
  assert.match(libraryOnceExpanded, /validate-agent-sync/);
  assert.match(libraryOnceExpanded, /sync-builders/);
  assert.match(libraryOnceExpanded, /rawJson\.agentExecutionProof/);
  assert.match(libraryOnceExpanded, /complete exactly\s+the task IDs returned by the CLI/i);
  assert.match(libraryOnceExpanded, /fetchTasks/);
  assert.match(libraryOnceExpanded, /single-post\s+`?summary`?/);
  assert.match(libraryOnceExpanded, /summaryInstructions\.prompt/);
  assert.match(libraryOnceExpanded, /[Dd]o not\s+read prompt files/);
  assert.match(libraryOnceExpanded, /do not fetch `context\.prompts`/);
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
  assert.match(libraryOnceExpanded, /Do not use `--force`/);
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
  assert.match(digestOncePrompt, /prepare --days 1/);
  assert.match(digestOncePrompt, /Use agent judgment only for the digest-writing step/);
  assert.match(digestOncePrompt, /execution\s+contract, not as user-facing documentation/);
  assert.doesNotMatch(digestOncePrompt, /Environment contract/);
  // Per-source prompt files were replaced with DB-backed prompts surfaced
  // through context.sources.<id>.summaryPrompt.body and context.digest.*.
  // The digest prompt now references those context paths instead of disk
  // markdown files.
  assert.match(digestOncePrompt, /context\.sources\.x\.summaryPrompt\.body/);
  assert.match(digestOncePrompt, /context\.sources\.podcast\.summaryPrompt\.body/);
  assert.match(digestOncePrompt, /context\.sources\.blog\.summaryPrompt\.body/);
  assert.match(digestOncePrompt, /context\.digest\.digestIntro/);
  assert.match(digestOncePrompt, /context\.digest\.translate/);
  assert.match(libraryCronSetupPrompt, /builder-agent-runner\.sh library-cron/);
  // Setup now pins the chosen runtime in $AGENT_DIR/runtime so the
  // runner picks the matching unattended-mode invocation at cron-fire
  // time. {{AGENT_RUNTIME}} is substituted server-side from the
  // ?runtime= URL param the website picker sets.
  assert.match(libraryCronSetupPrompt, /\{\{AGENT_RUNTIME\}\}/);
  assert.match(libraryCronSetupPrompt, /\{\{AGENT_RUNTIME_LABEL\}\}/);
  assert.match(libraryCronSetupPrompt, /Pin the scheduled runtime/);
  assert.match(libraryCronSetupPrompt, /\/runtime"/);
  assert.match(libraryCronSetupPrompt, /5\. Install the schedule/);
  assert.match(libraryCronSetupPrompt, /crontab/);
  assert.match(libraryCronSetupPrompt, /Do not use `--force`/);
  assert.match(libraryCronSetupPrompt, /fetchTasks/);
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
    "3. Pin the scheduled runtime",
    "5. Install the schedule",
    "launchctl bootstrap",
    "6. Run one immediate smoke check",
    "report its output",
  ]);
  assert.match(digestCronSetupPrompt, /builder-agent-runner\.sh digest-cron/);
  assert.match(digestCronSetupPrompt, /3\. Install the schedule/);
  assert.match(digestCronSetupPrompt, /crontab/);
  assert.doesNotMatch(skillPromptActions, /fetch-personal[^\n`]*--force/);
  assert.match(cli, /realpathSync\(fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(cli, /existsSync\(process\.argv\[1\]\)/);
  assert.match(cli, /validate-agent-sync/);
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
  assert.match(runner, /openclaw agent --local --message/);
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
  assert.match(runner, /--auto-approve/);
  assert.match(runner, /\$AGENT_DIR\/runtime/);
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
  assert.match(skill, /Install From Web App/);
  assert.match(skill, /Scheduled Jobs/);
  assert.match(skill, /builder-agent-runner\.sh digest-cron/);
  assert.match(skill, /OpenClaw CLI/);
  assert.match(skill, /validate-agent-sync/);
  assert.match(skill, /failed extraction attempts are not command-contract\s+failures/);
  assert.match(skill, /~\/\.builder-blog\/builder-digest\.mjs/);
  // Cron contract = same shared fragment, asserted on the EXPANDED prompt.
  assert.match(libraryCronExpanded, /fetch-personal --days 30 --limit 3/);
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
  assert.match(digestCronPrompt, /prepare --days 1/);
  assert.match(digestCronPrompt, /builder-blog-digest\.md/);
  assert.match(digestCronPrompt, /Only use agent judgment to write the digest body/);
  assert.match(digestCronPrompt, /Agent discretion boundary/);
  assert.match(digestCronPrompt, /The only creative step is writing/);
  assert.doesNotMatch(digestCronPrompt, /api\/skill\/bootstrap/);
  assert.match(digestCronPrompt, /runner already downloaded the latest skill files/);
  assert.match(digestCronPrompt, /summarize-tweets\.md/);
  assert.match(digestCronPrompt, /summarize-podcast\.md/);
  assert.match(digestCronPrompt, /summarize-blogs\.md/);
  assert.match(digestCronPrompt, /digest-intro\.md/);
  assert.match(digestCronPrompt, /translate\.md/);
  assert.equal(skill.includes("/Users/jie/code/builder_blog"), false);
  assert.equal(skill.includes("node scripts/builder-digest.mjs"), false);
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

  const empty = parseSkillDigestPayload({ title: "Bad", content: "" });
  assert.equal(empty.success, false);
});

test("digest feed user path derives context window from user frequency and max post age", () => {
  const now = new Date("2026-05-23T12:00:00.000Z");
  const preference = {
    digestFrequency: DigestFrequency.CUSTOM,
    digestCustomFrequencyDays: 3,
    digestMaxPostAgeDays: 45,
  };

  assert.equal(digestFrequencyDays(preference), 3);
  assert.equal(digestMaxPostAgeDays(preference), 45);
  assert.equal(digestFallbackSince(now, preference).toISOString(), "2026-05-20T12:00:00.000Z");
  assert.equal(digestMaxAgeCutoff(now, preference).toISOString(), "2026-04-08T12:00:00.000Z");

  const contextRoute = readFileSync("src/app/api/skill/context/route.ts", "utf8");
  assert.match(contextRoute, /publishedAfter: maxAgeCutoff/);
  assert.match(contextRoute, /publishedAfter: maxAgeCutoff/);
  assert.match(contextRoute, /newly fetched items created after the last digest/);
  assert.match(contextRoute, /includePrompts/);
  // context.prompts (kept for back-compat) is now derived from DB at request time,
  // not from a static DIGEST_PROMPTS import. Just assert the field is still emitted.
  assert.match(contextRoute, /prompts:/);
  const cli = readFileSync("scripts/builder-digest.mjs", "utf8");
  assert.match(cli, /api\/skill\/context\?includePrompts=1/);
  assert.match(cli, /api\/skill\/context\?days=/);
  assert.doesNotMatch(cli, /postSummaryTasksForBuilders\(builders,\s*context\.prompts\)/);
  assert.doesNotMatch(cli, /withSummaryInstructions\(task,\s*context\.prompts\)/);
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
      "digest",
      "digestIntro",
      "fetchPodcastAudio",
      "summarizeBlogs",
      "summarizePodcast",
      "summarizeTweets",
      "translate",
    ].sort(),
  );
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizePodcast, /podcast transcript/i);
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizeTweets, /X\/Twitter Summary Prompt/);
  assert.match(DEFAULT_DIGEST_PROMPTS.summarizeBlogs, /Blog Post Summary Prompt/);
  assert.match(DEFAULT_DIGEST_PROMPTS.digestIntro, /Digest Intro Prompt/);
  assert.match(DEFAULT_DIGEST_PROMPTS.translate, /simplified Chinese/i);
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
  // UI copy migrated from "fetched" to "summarized" for compliance — see
  // CLAUDE.md design context. The canonical display component is PostCard;
  // fetched-post-* classes still use "fetched" because the storage layer is
  // still the FeedItem fetch path.
  assert.equal(builderFeedItems.includes("Summarized posts"), true);
  assert.equal(builderFeedItems.includes("PostCard"), true);
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
    builderSourceLabel({
      kind: BuilderKind.BLOG,
      sourceUrl: "https://example.com/blog",
      fetchUrl: null,
    }),
    "Blog",
  );
});

test("source registry supports future source types without new BuilderKind enum values", () => {
  assert.equal(
    sourceTypeIdForBuilder({
      kind: BuilderKind.WEBSITE,
      sourceType: null,
      sourceUrl: "https://example.com/research.pdf",
      fetchUrl: null,
    }),
    "pdf",
  );
  assert.equal(sourceDefinitionForType("pdf")?.staticLabel, "PDF");
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
