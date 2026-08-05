import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  CLOUD_SOURCE_SUBMISSION_LIMIT,
  normalizeCloudSourceSubmissionInput,
  parseCloudFetchPlanPatchPayload,
} from "../src/lib/cloud-source-contracts";
import {
  CloudSourceSubmissionError,
  submitUserPrivateLibraryToCloud,
} from "../src/lib/cloud-source-library";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("cloud source submission route authenticates, normalizes input, and rate limits", () => {
  const route = source("src/app/api/cloud-library/source-submissions/route.ts");

  assert.match(route, /getCurrentSession\(\)/);
  assert.match(route, /normalizeCloudSourceSubmissionInput/);
  assert.match(route, /builderIds: body\?\.builderIds/);
  assert.match(route, /submitUserPrivateLibraryToCloud/);
  assert.match(route, /builderIds: input\.builderIds/);
  assert.match(route, /CLOUD_SUBMISSION_RATE_LIMIT_MS/);
  assert.match(route, /sourcesSubmitted/);
  assert.match(route, /tasksSubmitted/);
  assert.doesNotMatch(route, /getUserFromBearer/);
  assert.doesNotMatch(route, /AgentToken/);
});

test("cloud source submission input limits selected source ids", () => {
  assert.equal(CLOUD_SOURCE_SUBMISSION_LIMIT, 30);
  const input = normalizeCloudSourceSubmissionInput({
    frequency: "week",
    summaryLanguage: "zh",
    builderIds: ["builder_1", "builder_1", "builder_2"],
  });

  assert.deepEqual(input.builderIds, ["builder_1", "builder_2"]);
  const maximumSelection = Array.from(
    { length: CLOUD_SOURCE_SUBMISSION_LIMIT },
    (_, index) => `maximum_${index}`,
  );
  assert.deepEqual(
    normalizeCloudSourceSubmissionInput({
      frequency: "day",
      summaryLanguage: "en",
      builderIds: maximumSelection,
    }).builderIds,
    maximumSelection,
  );
  assert.throws(
    () =>
      normalizeCloudSourceSubmissionInput({
        frequency: "day",
        summaryLanguage: "zh",
        builderIds: Array.from({ length: CLOUD_SOURCE_SUBMISSION_LIMIT + 1 }, (_, index) => `b_${index}`),
      }),
    /at most 30 sources/,
  );
});

test("cloud source library submission copies only private sources to language owner", () => {
  const library = source("src/lib/cloud-source-library.ts");

  assert.match(library, /CLOUD_SOURCE_SUBMISSION_LIMIT/);
  assert.match(library, /selectedBuilderIds/);
  assert.match(library, /Select up to \$\{CLOUD_SOURCE_SUBMISSION_LIMIT\} sources/);
  assert.match(library, /Some selected sources are not in your library/);
  assert.match(library, /ensureCloudLanguageLibraryForSubmission/);
  assert.match(library, /upsertCloudLanguageLibraryWithSystemOwner/);
  assert.match(library, /BuilderPoolOrigin\.PERSONAL_SYNC/);
  assert.match(library, /builder:\s*\{\s*ownerUserId: params\.userId\s*\}/);
  assert.match(library, /copyBuilderToCloudOwner/);
  assert.match(library, /cloudOwnerUserId: cloudLibrary\.ownerUserId/);
  assert.match(library, /cloudSourceSubmission\.upsert/);
  assert.match(library, /recomputeCloudSourceTask/);
  assert.match(library, /syncCloudLanguageLibraryHub/);
  assert.match(library, /activeCloudBuilderIds/);
  assert.match(library, /builderIds: activeCloudBuilderIds/);
  assert.match(library, /languagesToSync/);
});

test("submit-all excludes platform-maintained sources and does not count them against the submission limit", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = previousDatabaseUrl ?? "postgresql://followbrief:followbrief@127.0.0.1:5432/followbrief_test";
  const copyCalls: string[] = [];
  const submissionUpserts: unknown[] = [];
  const taskUpserts: unknown[] = [];
  const eligibleSources = Array.from(
    { length: CLOUD_SOURCE_SUBMISSION_LIMIT - 2 },
    (_, index) => ({
      builderId: `builder_blog_${index}`,
      builder: {
        id: `builder_blog_${index}`,
        ownerUserId: "user_1",
        kind: "BLOG",
      sourceType: "blog",
      name: `Blog ${index}`,
      handle: null,
      sourceUrl: `https://example.com/blog/${index}.xml`,
      fetchUrl: null,
        avatarUrl: null,
        avatarDataUrl: null,
        bio: null,
      },
    }),
  );
  eligibleSources.push(
    {
      builderId: "builder_github_trending",
      builder: {
        id: "builder_github_trending",
        ownerUserId: "user_1",
        kind: "WEBSITE",
        sourceType: "github_trending",
        name: "GitHub Trending",
        handle: null,
        sourceUrl: "https://github.com/trending",
        fetchUrl: null,
        avatarUrl: null,
        avatarDataUrl: null,
        bio: null,
      },
    },
    {
      builderId: "builder_product_hunt",
      builder: {
        id: "builder_product_hunt",
        ownerUserId: "user_1",
        kind: "WEBSITE",
        sourceType: "product_hunt_top_products",
        name: "Product Hunt",
        handle: null,
        sourceUrl: "https://www.producthunt.com/",
        fetchUrl: null,
        avatarUrl: null,
        avatarDataUrl: null,
        bio: null,
      },
    },
  );
  const maintainedSource = {
    builderId: "builder_launches",
    builder: {
      id: "builder_launches",
      ownerUserId: "user_1",
      kind: "WEBSITE",
      sourceType: "new_product_launches",
      name: "Launches",
      handle: null,
      sourceUrl: "https://followbrief.worldstatelabs.com/?source=new-product-launches",
      fetchUrl: null,
      avatarUrl: null,
      avatarDataUrl: null,
      bio: null,
    },
  };

  const prisma = {
    builderPoolEntry: {
      async findMany() {
        return [...eligibleSources, maintainedSource];
      },
    },
    user: {
      async upsert() {
        return {
          id: "cloud_owner_en",
          email: "cloud-source-en@followbrief.system",
          name: "FollowBrief Cloud - English",
        };
      },
    },
    builder: {
      async findMany(args: { where?: { id?: { in?: string[] } } }) {
        const requestedIds = args.where?.id?.in ?? eligibleSources.map((source) => source.builderId);
        return requestedIds.map((id) => ({ id }));
      },
      async update() {
        return {};
      },
    },
    cloudLanguageLibrary: {
      async findUnique() {
        return {
          id: "cloud_library_en",
          summaryLanguage: "en",
          ownerUserId: "cloud_owner_en",
          hubEntryId: null,
          enabled: true,
          owner: {
            id: "cloud_owner_en",
            email: "cloud-source-en@followbrief.system",
            name: "FollowBrief Cloud - English",
          },
          hubEntry: null,
        };
      },
      async upsert() {
        return {
          id: "cloud_library_en",
          summaryLanguage: "en",
          ownerUserId: "cloud_owner_en",
          hubEntryId: null,
          enabled: true,
          owner: {
            id: "cloud_owner_en",
            email: "cloud-source-en@followbrief.system",
            name: "FollowBrief Cloud - English",
          },
          hubEntry: null,
        };
      },
      async update() {
        return {};
      },
    },
    libraryHubEntry: {
      async upsert() {
        return { id: "hub_en" };
      },
    },
    libraryHubItem: {
      async deleteMany() {
        return { count: 0 };
      },
      async createMany() {
        return { count: 0 };
      },
    },
    cloudSourceSubmission: {
      async findMany(args: { where?: { userId?: string; summaryLanguage?: string; cloudBuilderId?: string } }) {
        if (args.where?.cloudBuilderId) {
          return [
            {
              frequency: "DAILY",
              submittedAt: new Date("2026-08-02T00:00:00.000Z"),
            },
          ];
        }
        return [];
      },
      async upsert(args: unknown) {
        submissionUpserts.push(args);
        return {};
      },
      async updateMany() {
        return { count: 0 };
      },
    },
    cloudSourceTask: {
      async findMany() {
        return [];
      },
      async upsert(args: unknown) {
        taskUpserts.push(args);
        return {};
      },
      async updateMany() {
        return { count: 0 };
      },
    },
  };

  try {
    const result = await submitUserPrivateLibraryToCloud({
      userId: "user_1",
      frequency: "DAILY",
      summaryLanguage: "en",
      prisma: prisma as never,
      copyBuilderUpsert: async ({ sourceType, name }) => {
        copyCalls.push(`${sourceType}:${name}`);
        return { id: `cloud_${name.replace(/\s+/g, "_")}` };
      },
      syncHub: async () => ({ entry: {} as never, builderCount: 0 }),
    });

    assert.equal(result.sourcesSubmitted, CLOUD_SOURCE_SUBMISSION_LIMIT - 2);
    assert.equal(copyCalls.length, CLOUD_SOURCE_SUBMISSION_LIMIT - 2);
    assert.equal(submissionUpserts.length, CLOUD_SOURCE_SUBMISSION_LIMIT - 2);
    assert.equal(taskUpserts.length, CLOUD_SOURCE_SUBMISSION_LIMIT - 2);
    assert.equal(copyCalls.some((call) => call.startsWith("new_product_launches:")), false);
    assert.equal(copyCalls.some((call) => call.startsWith("github_trending:")), false);
    assert.equal(copyCalls.some((call) => call.startsWith("product_hunt_top_products:")), false);
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});

test("explicitly selected platform-maintained sources fail before any cloud rows are written", async () => {
  const writes = {
    cloudLanguageLibraryReads: 0,
    cloudLanguageLibraryWrites: 0,
    submissionWrites: 0,
    taskWrites: 0,
    builderCopies: 0,
  };

  const prisma = {
    builderPoolEntry: {
      async findMany() {
        return [
          {
            builderId: "builder_blog_1",
            builder: {
              id: "builder_blog_1",
              ownerUserId: "user_1",
              kind: "BLOG",
              sourceType: "blog",
              name: "Blog 1",
              handle: null,
              sourceUrl: "https://example.com/blog.xml",
              fetchUrl: null,
              avatarUrl: null,
              avatarDataUrl: null,
              bio: null,
            },
          },
          {
            builderId: "builder_launches",
            builder: {
              id: "builder_launches",
              ownerUserId: "user_1",
              kind: "WEBSITE",
              sourceType: "new_product_launches",
              name: "Launches",
              handle: null,
              sourceUrl: "https://followbrief.worldstatelabs.com/?source=new-product-launches",
              fetchUrl: null,
              avatarUrl: null,
              avatarDataUrl: null,
              bio: null,
            },
          },
        ];
      },
    },
    cloudLanguageLibrary: {
      async findUnique() {
        writes.cloudLanguageLibraryReads += 1;
        return null;
      },
      async upsert() {
        writes.cloudLanguageLibraryWrites += 1;
        return {};
      },
      async update() {
        writes.cloudLanguageLibraryWrites += 1;
        return {};
      },
    },
    cloudSourceSubmission: {
      async findMany() {
        return [];
      },
      async upsert() {
        writes.submissionWrites += 1;
        return {};
      },
      async updateMany() {
        writes.submissionWrites += 1;
        return { count: 0 };
      },
    },
    cloudSourceTask: {
      async findMany() {
        return [];
      },
      async upsert() {
        writes.taskWrites += 1;
        return {};
      },
      async updateMany() {
        writes.taskWrites += 1;
        return { count: 0 };
      },
    },
  };

  await assert.rejects(
    () =>
      submitUserPrivateLibraryToCloud({
        userId: "user_1",
        frequency: "DAILY",
        summaryLanguage: "en",
        builderIds: ["builder_blog_1", "builder_launches"],
        prisma: prisma as never,
        copyBuilderUpsert: async () => {
          writes.builderCopies += 1;
          return { id: "cloud_builder" };
        },
        syncHub: async () => ({ entry: {} as never, builderCount: 0 }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof CloudSourceSubmissionError);
      assert.equal(error.message, "FollowBrief already maintains this source.");
      assert.equal(error.status, 400);
      assert.equal((error as CloudSourceSubmissionError & { code?: string }).code, "platform_managed_source");
      return true;
    },
  );

  assert.equal(writes.cloudLanguageLibraryReads, 0);
  assert.equal(writes.cloudLanguageLibraryWrites, 0);
  assert.equal(writes.submissionWrites, 0);
  assert.equal(writes.taskWrites, 0);
  assert.equal(writes.builderCopies, 0);
});

test("mixed explicit selection with owned maintained and missing source returns generic ownership failure before any writes", async () => {
  const writes = {
    cloudLanguageLibraryReads: 0,
    cloudLanguageLibraryWrites: 0,
    submissionWrites: 0,
    taskWrites: 0,
    builderCopies: 0,
  };

  const prisma = {
    builderPoolEntry: {
      async findMany() {
        return [
          {
            builderId: "builder_blog_1",
            builder: {
              id: "builder_blog_1",
              ownerUserId: "user_1",
              kind: "BLOG",
              sourceType: "blog",
              name: "Blog 1",
              handle: null,
              sourceUrl: "https://example.com/blog.xml",
              fetchUrl: null,
              avatarUrl: null,
              avatarDataUrl: null,
              bio: null,
            },
          },
          {
            builderId: "builder_launches",
            builder: {
              id: "builder_launches",
              ownerUserId: "user_1",
              kind: "WEBSITE",
              sourceType: "new_product_launches",
              name: "Launches",
              handle: null,
              sourceUrl: "https://followbrief.worldstatelabs.com/?source=new-product-launches",
              fetchUrl: null,
              avatarUrl: null,
              avatarDataUrl: null,
              bio: null,
            },
          },
        ];
      },
    },
    cloudLanguageLibrary: {
      async findUnique() {
        writes.cloudLanguageLibraryReads += 1;
        return null;
      },
      async upsert() {
        writes.cloudLanguageLibraryWrites += 1;
        return {};
      },
      async update() {
        writes.cloudLanguageLibraryWrites += 1;
        return {};
      },
    },
    cloudSourceSubmission: {
      async findMany() {
        return [];
      },
      async upsert() {
        writes.submissionWrites += 1;
        return {};
      },
      async updateMany() {
        writes.submissionWrites += 1;
        return { count: 0 };
      },
    },
    cloudSourceTask: {
      async findMany() {
        return [];
      },
      async upsert() {
        writes.taskWrites += 1;
        return {};
      },
      async updateMany() {
        writes.taskWrites += 1;
        return { count: 0 };
      },
    },
  };

  await assert.rejects(
    () =>
      submitUserPrivateLibraryToCloud({
        userId: "user_1",
        frequency: "DAILY",
        summaryLanguage: "en",
        builderIds: ["builder_launches", "builder_missing"],
        prisma: prisma as never,
        copyBuilderUpsert: async () => {
          writes.builderCopies += 1;
          return { id: "cloud_builder" };
        },
        syncHub: async () => ({ entry: {} as never, builderCount: 0 }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof CloudSourceSubmissionError);
      assert.equal(error.message, "Some selected sources are not in your library.");
      assert.equal(error.status, 400);
      assert.equal((error as CloudSourceSubmissionError).code, null);
      return true;
    },
  );

  assert.equal(writes.cloudLanguageLibraryReads, 0);
  assert.equal(writes.cloudLanguageLibraryWrites, 0);
  assert.equal(writes.submissionWrites, 0);
  assert.equal(writes.taskWrites, 0);
  assert.equal(writes.builderCopies, 0);
});

test("cloud language hub entries stay internal to cloud reuse", () => {
  const hub = source("src/lib/library-hub.ts");
  const hubPage = source("src/app/(workspace)/library-hub/page.tsx");
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");

  assert.match(hub, /export function userImportableLibraryHubEntryWhere/);
  assert.match(hub, /cloudLanguageLibrary:\s*\{\s*is:\s*null\s*\}/);
  assert.match(hub, /\.\.\.userImportableLibraryHubEntryWhere\(\)/);
  assert.match(hubPage, /where:\s*userImportableLibraryHubEntryWhere\(\)/);
  assert.match(buildersPage, /hubEntry:\s*userImportableLibraryHubEntryWhere\(\)/);
});

test("admin cloud fetch queue and lease routes support session or bearer admin auth", () => {
  const queueRoute = source("src/app/api/admin/cloud-fetch/queue/route.ts");
  const leaseRoute = source("src/app/api/admin/cloud-fetch/lease/route.ts");
  const heartbeatRoute = source("src/app/api/admin/cloud-fetch/heartbeat/route.ts");
  const adminHelper = source("src/lib/cloud-source-admin.ts");

  for (const route of [queueRoute, leaseRoute, heartbeatRoute]) {
    assert.match(route, /requireCloudFetchAdmin\(request\)/);
    assert.match(route, /NextResponse\.json\(\{ error: "Unauthorized" \}/);
  }
  assert.match(adminHelper, /getCurrentSession\(\)/);
  assert.match(adminHelper, /getUserFromBearer\(request\)/);
  assert.match(adminHelper, /isAdminEmail/);
  assert.match(queueRoute, /materializeDueCloudFetchQueue/);
  assert.match(leaseRoute, /leaseCloudFetchTasks/);
  assert.match(leaseRoute, /select:\s*\{\s*id:\s*true,\s*createdAt:\s*true\s*\}/);
  assert.match(leaseRoute, /createdByUserId:\s*admin\.user\.id/);
  assert.match(leaseRoute, /agentJobRunId:\s*jobRun\.id/);
  assert.match(heartbeatRoute, /heartbeatCloudFetchRun/);
});

test("admin cloud fetch config routes validate patches behind admin auth", () => {
  const configRoute = source("src/app/api/admin/cloud-fetch/config/route.ts");
  const languageRoute = source("src/app/api/admin/cloud-fetch/language-libraries/route.ts");

  for (const route of [configRoute, languageRoute]) {
    assert.match(route, /requireCloudFetchAdmin\(request\)/);
    assert.match(route, /NextResponse\.json\(\{ error: "Unauthorized" \}/);
  }
  assert.match(configRoute, /normalizeCloudFetchConfigPatchInput/);
  assert.match(configRoute, /cloudFetchConfig\.upsert/);
  assert.match(languageRoute, /normalizeCloudLanguageLibraryPatchInput/);
  assert.match(languageRoute, /upsertCloudLanguageLibraryWithSystemOwner/);
  assert.doesNotMatch(languageRoute, /ownerEmail/);
  assert.doesNotMatch(languageRoute, /findCloudLibraryOwner/);
});

test("admin cloud fetch sync route uses admin auth and cloud sync status helper", () => {
  const syncRoute = source("src/app/api/admin/cloud-fetch/sync/route.ts");

  assert.match(syncRoute, /requireCloudFetchAdmin\(request\)/);
  assert.match(syncRoute, /parseCloudFetchSyncPayload/);
  assert.match(syncRoute, /syncBuilderFeedItems/);
  assert.match(syncRoute, /cloudSourceTask\.findMany/);
  assert.match(syncRoute, /allowedBuilderIds/);
  assert.match(syncRoute, /validateTerminalCoverage/);
  assert.match(syncRoute, /reconcileCloudFetchTerminalResult/);
  assert.match(syncRoute, /sourceTaskOutcomes/);
  assert.match(syncRoute, /requestDigest/);
  assert.match(syncRoute, /applyCloudFetchTaskSyncResult/);
  assert.match(syncRoute, /sourceTaskResult/);
  assert.match(syncRoute, /runSummary/);
  assert.match(syncRoute, /upsertSourceCandidateFromCloudBuilder/);
  assert.match(syncRoute, /syncCloudLanguageLibraryHub/);
  assert.match(syncRoute, /taskResult\.syncedPosts > 0/);
  assert.match(syncRoute, /feedSync/);
  assert.match(syncRoute, /loadCloudFetchSyncConfig/);
  assert.match(syncRoute, /NextResponse\.json\(\{ error: "Unauthorized" \}/);
});

test("cloud fetch plan patch payload validates grouped post budgets and rejects duplicates", () => {
  const parsed = parseCloudFetchPlanPatchPayload({
    runId: "run_1",
    plans: [
      {
        cloudSourceTaskId: "source_1",
        posts: [
          {
            postTaskId: "post_1",
            title: "Post one",
            url: "https://example.com/post-one",
            workerId: "worker-0",
            estimatedWorkSeconds: 3_000,
            executionBudgetSeconds: 3_600,
            workloadClass: "standard",
            budgetReason: "minimum_budget",
            deadlineState: "on_time",
            mustSucceedBy: "2026-07-19T16:00:00.000Z",
          },
        ],
      },
    ],
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.plans[0]?.posts[0]?.title, "Post one");
    assert.equal(parsed.data.plans[0]?.posts[0]?.url, "https://example.com/post-one");
    assert.equal(parsed.data.plans[0]?.posts[0]?.workerId, "worker-0");
  }
  if (!parsed.success) return;
  assert.equal(parsed.data.runId, "run_1");
  assert.equal(parsed.data.plans[0]?.posts[0]?.postTaskId, "post_1");

  const duplicate = parseCloudFetchPlanPatchPayload({
    runId: "run_1",
    plans: [
      {
        cloudSourceTaskId: "source_1",
        posts: [
          {
            postTaskId: "post_1",
            estimatedWorkSeconds: 3_000,
            executionBudgetSeconds: 3_600,
            workloadClass: "standard",
            budgetReason: "minimum_budget",
            deadlineState: "on_time",
          },
          {
            postTaskId: "post_1",
            estimatedWorkSeconds: 3_100,
            executionBudgetSeconds: 3_600,
            workloadClass: "standard",
            budgetReason: "minimum_budget",
            deadlineState: "at_risk",
          },
        ],
      },
    ],
  });
  assert.equal(duplicate.success, false);

  const invalidBudget = parseCloudFetchPlanPatchPayload({
    runId: "run_1",
    plans: [
      {
        cloudSourceTaskId: "source_1",
        posts: [
          {
            postTaskId: "post_1",
            estimatedWorkSeconds: 100,
            executionBudgetSeconds: 3_599,
            workloadClass: "standard",
            budgetReason: "minimum_budget",
            deadlineState: "on_time",
          },
        ],
      },
    ],
  });
  assert.equal(invalidBudget.success, false);
});

test("admin cloud fetch plan route requires admin auth, stale-write protection, and merged execution plans", () => {
  const route = source("src/app/api/admin/cloud-fetch/plan/route.ts");
  const syncRoute = source("src/app/api/admin/cloud-fetch/sync/route.ts");

  assert.match(route, /requireCloudFetchAdmin\(request\)/);
  assert.match(route, /parseCloudFetchPlanPatchPayload/);
  assert.match(route, /cloud_run_not_running/);
  assert.match(route, /cloud_source_already_finalized/);
  assert.match(route, /cloud_source_finalize_race/);
  assert.match(route, /cloudFetchConflictBody/);
  assert.match(route, /lockResetFenceForWorker\(tx, run\.startedAt\)/);
  assert.match(route, /lockCloudFetchRunTaskRows\(tx, \{ runId: run\.id, cloudSourceTaskIds: taskIds \}\)/);
  assert.match(route, /const runningTasks = await tx\.cloudFetchRunTask\.findMany/);
  assert.match(route, /mergeCloudFetchExecutionPlanDetails/);
  assert.match(route, /if \(error instanceof StaleWorkerWriteError\)/);
  assert.match(route, /status: error\.statusCode/);
  assert.match(route, /NextResponse\.json\(\{ error: "Unauthorized" \}/);

  assert.match(syncRoute, /lockResetFenceForWorker\(tx, run\.startedAt\)/);
  assert.match(syncRoute, /lockCloudFetchRunTaskRows\(tx, \{ runId: run\.id, cloudSourceTaskIds: taskIds \}\)/);
  assert.match(syncRoute, /const runTasks = await tx\.cloudFetchRunTask\.findMany/);
});

test("cloud conflict responses are machine-readable and preserve retryability", () => {
  const conflict = source("src/lib/cloud-fetch-conflict.ts");
  const cli = source("scripts/builder-digest.mjs");

  assert.match(conflict, /code: error\.code/);
  assert.match(conflict, /retryable: error\.retryable/);
  assert.match(cli, /httpResponseCode = details\.responseCode/);
  assert.match(cli, /httpRetryable = details\.retryable/);
  assert.match(cli, /if \(typeof error\.httpRetryable === "boolean"\) return error\.httpRetryable/);
});

test("admin cloud fetch sync route keeps skipped post outcomes out of source failure counts", () => {
  const reconcile = source("src/lib/cloud-fetch-terminal-reconcile.ts");

  assert.match(reconcile, /post\.status === "skipped"/);
  assert.match(reconcile, /post\.status === "failed" \|\|/);
  assert.match(reconcile, /post\.status === "blocked" && post\.failureReason !== "asr_capability_missing"/);
  assert.match(reconcile, /deferredPosts > 0 && failedPosts === 0/);
  assert.doesNotMatch(reconcile, /failedPosts = posts\.length/);
});

test("cloud fetch log surfaces do not render raw source-level failure reasons as red text", () => {
  const adminLog = source("src/components/AdminCloudFetchLog.tsx");
  const sourceLogItem = source("src/components/CloudSourceLogItem.tsx");
  const panel = source("src/components/FetchLogPanel.tsx");
  const styles = source("src/app/globals.css");

  for (const component of [adminLog, sourceLogItem]) {
    assert.doesNotMatch(component, /cloud-fetch-log-task-error/);
    assert.doesNotMatch(component, /<p[^>]*>\{[^}]*failureReason[^}]*\}<\/p>/);
  }
  assert.doesNotMatch(styles, /cloud-fetch-log-task-error/);
  assert.match(panel, /from "@\/lib\/fetch-failure-taxonomy"/);
  assert.match(source("src/lib/fetch-failure-taxonomy.ts"), /no_primary_content:[\s\S]*No primary content/);
});

test("cloud source scheduler exposes DB-backed materialize and lease workflows", () => {
  const scheduler = source("src/lib/cloud-source-scheduler.ts");

  assert.match(scheduler, /export async function materializeDueCloudFetchQueue/);
  assert.match(scheduler, /export async function leaseCloudFetchTasks/);
  assert.match(scheduler, /planCloudFetchWindow/);
  assert.match(scheduler, /CloudFetchQueueItem_active_task_key/);
  assert.match(scheduler, /tokenBudgetPerHour/);
  assert.match(scheduler, /requestedLimit/);
  assert.match(scheduler, /leaseExpiresAt/);
});

test("Cloud worker ownership keeps legacy runs nullable and adds AgentJobRun ownership for new runs", () => {
  const schema = source("prisma/schema.prisma");
  const migrationPath = "prisma/migrations/000092_cloud_fetch_worker_ownership/migration.sql";
  const migration = existsSync(join(root, migrationPath)) ? source(migrationPath) : "";
  const cloudFetchRunModel = schema.match(/model CloudFetchRun \{[\s\S]*?\n\}/m)?.[0] ?? "";
  const agentJobRunModel = schema.match(/model AgentJobRun \{[\s\S]*?\n\}/m)?.[0] ?? "";

  assert.match(agentJobRunModel, /cloudFetchRuns\s+CloudFetchRun\[\]/);
  assert.match(cloudFetchRunModel, /agentJobRunId\s+String\?/);
  assert.match(
    cloudFetchRunModel,
    /agentJobRun\s+AgentJobRun\?\s+@relation\(fields:\s*\[agentJobRunId\],\s*references:\s*\[id\],\s*onDelete:\s*SetNull\)/,
  );
  assert.match(cloudFetchRunModel, /@@index\(\[createdByUserId,\s*agentJobRunId,\s*status\]\)/);

  assert.ok(existsSync(join(root, migrationPath)), "expected Cloud worker ownership migration to exist");
  assert.match(migration, /ALTER TABLE "CloudFetchRun" ADD COLUMN "agentJobRunId" TEXT;/);
  assert.match(
    migration,
    /FOREIGN KEY \("agentJobRunId"\) REFERENCES "AgentJobRun"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE;/,
  );
  assert.doesNotMatch(migration, /UPDATE\s+"CloudFetchRun"\s+SET\s+"agentJobRunId"/);
});

test("cloud submission reconciles to a single active submission and cancels superseded fetches", () => {
  const library = source("src/lib/cloud-source-library.ts");

  assert.match(library, /planSubmissionReconciliation/);
  assert.match(library, /cloudSourceSubmission\.findMany/);
  assert.match(library, /cloudSourceSubmission\.updateMany/);
  assert.match(library, /active: false/);
  assert.match(library, /cancelQueuedCloudFetchForTasks/);
});

test("cloud submission route exposes a GET summary of the user's active submission", () => {
  const route = source("src/app/api/cloud-library/source-submissions/route.ts");

  assert.match(route, /export async function GET/);
  assert.match(route, /getCurrentSession\(\)/);
  assert.match(route, /getUserCloudSubmissionSummary/);
  assert.match(route, /hasActiveSubmission/);
});

test("cloud submission route lets the user stop their active cloud fetch submissions", () => {
  const route = source("src/app/api/cloud-library/source-submissions/route.ts");

  assert.match(route, /export async function DELETE/);
  assert.match(route, /getCurrentSession\(\)/);
  assert.match(route, /stopUserCloudSourceSubmissions\(\{ userId \}\)/);
  assert.match(route, /stoppedSources/);
  assert.match(route, /cancelledQueuedTasks/);
});

test("cloud source submission route serializes typed platform-managed selection errors", () => {
  const route = source("src/app/api/cloud-library/source-submissions/route.ts");

  assert.match(route, /if \(error instanceof CloudSourceSubmissionError\)/);
  assert.match(route, /code: error\.code/);
  assert.match(route, /status: error\.status/);
});

test("cloud source submission route only includes code for typed selection failures", () => {
  const route = source("src/app/api/cloud-library/source-submissions/route.ts");

  assert.match(route, /\.\.\.\(error\.code \? \{ code: error\.code \} : \{\}\)/);
});

test("cloud scheduler is work-conserving: releases by nextAttemptAt, no latest-bucket deferral", () => {
  const scheduler = source("src/lib/cloud-source-scheduler.ts");

  // releaseAt is no longer pushed forward to (mustSucceedBy - schedulingLeadMinutes),
  // and the latest-feasible-bucket parking strategy is gone.
  assert.doesNotMatch(scheduler, /const targetStartAt =/);
  assert.match(scheduler, /releaseAt = maxDate\(params\.now, task\.nextAttemptAt/);
  assert.doesNotMatch(scheduler, /latestFeasibleBucket/);
});
