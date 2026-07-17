import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cloudLanguageLibraryHubName,
  cloudLanguageSystemUserEmail,
  cloudLanguageSystemUserName,
  copyBuilderToCloudOwner,
  effectiveCloudFetchFrequency,
  ensureCloudLanguageSystemUser,
  getUserCloudSubmissionSummary,
  planSubmissionReconciliation,
  reassignCloudLanguageTaskBuildersToOwner,
  recomputeCloudSourceTask,
  stopUserCloudSourceSubmissions,
  summarizeActiveCloudSubmissions,
  upsertSourceCandidateFromCloudBuilder,
} from "../src/lib/cloud-source-library";

test("copyBuilderToCloudOwner preserves source identity while changing owner", async () => {
  const calls: unknown[] = [];
  const result = await copyBuilderToCloudOwner({
    cloudOwnerUserId: "cloud-owner-zh",
    userBuilder: {
      kind: "BLOG",
      sourceType: "blog",
      name: "Anthropic Engineering",
      handle: null,
      sourceUrl: "https://www.anthropic.com/engineering",
      fetchUrl: null,
      avatarUrl: "https://example.com/avatar.png",
      avatarDataUrl: null,
      bio: "Engineering posts",
    },
    upsert: async (params) => {
      calls.push(params);
      return { id: "cloud-builder" };
    },
  });

  assert.deepEqual(result, { id: "cloud-builder" });
  assert.deepEqual(calls, [
    {
      ownerUserId: "cloud-owner-zh",
      kind: "BLOG",
      sourceType: "blog",
      name: "Anthropic Engineering",
      handle: null,
      sourceUrl: "https://www.anthropic.com/engineering",
      fetchUrl: null,
      avatarUrl: "https://example.com/avatar.png",
      avatarDataUrl: null,
      bio: "Engineering posts",
      addedByUserId: null,
    },
  ]);
});

test("effectiveCloudFetchFrequency chooses daily when any active submission is daily", () => {
  assert.equal(effectiveCloudFetchFrequency(["WEEKLY", "DAILY", "WEEKLY"]), "DAILY");
  assert.equal(effectiveCloudFetchFrequency(["WEEKLY"]), "WEEKLY");
  assert.equal(effectiveCloudFetchFrequency([]), null);
});

test("cloud language library names are language-specific hub source libraries", () => {
  assert.equal(cloudLanguageLibraryHubName("zh"), "FollowBrief source library - Chinese");
  assert.equal(cloudLanguageLibraryHubName("en"), "FollowBrief source library - English");
  assert.equal(cloudLanguageLibraryHubName("source"), "FollowBrief source library - Original");
});

test("cloud language system owners are deterministic per summary language", async () => {
  assert.equal(cloudLanguageSystemUserEmail("zh"), "cloud-source-zh@followbrief.system");
  assert.equal(cloudLanguageSystemUserEmail("Chinese"), "cloud-source-chinese@followbrief.system");
  assert.equal(cloudLanguageSystemUserEmail("original"), "cloud-source-source@followbrief.system");
  assert.equal(cloudLanguageSystemUserName("zh"), "FollowBrief Cloud - Chinese");
  assert.equal(cloudLanguageSystemUserName("source"), "FollowBrief Cloud - Original");

  const calls: unknown[] = [];
  const prisma = {
    user: {
      async upsert(args: unknown) {
        calls.push(args);
        return {
          id: "cloud_user_zh",
          email: "cloud-source-zh@followbrief.system",
          name: "FollowBrief Cloud - Chinese",
        };
      },
    },
  };

  const user = await ensureCloudLanguageSystemUser({ summaryLanguage: "zh", prisma: prisma as never });

  assert.equal(user.id, "cloud_user_zh");
  assert.deepEqual(calls[0], {
    where: { email: "cloud-source-zh@followbrief.system" },
    update: { name: "FollowBrief Cloud - Chinese" },
    create: {
      email: "cloud-source-zh@followbrief.system",
      name: "FollowBrief Cloud - Chinese",
    },
    select: { id: true, email: true, name: true },
  });
});

test("cloud language owner migration rehomes existing task builders without changing builder ids", async () => {
  const updates: unknown[] = [];
  const prisma = {
    cloudSourceTask: {
      async findMany() {
        return [
          {
            builder: {
              id: "builder_old_owner",
              canonicalKey: "BLOG:https://example.com/feed.xml",
              ownerUserId: "admin_user",
            },
          },
          {
            builder: {
              id: "builder_already_system",
              canonicalKey: "BLOG:https://example.com/other.xml",
              ownerUserId: "cloud_user_zh",
            },
          },
        ];
      },
    },
    builder: {
      async update(args: unknown) {
        updates.push(args);
        return args;
      },
    },
  };

  const result = await reassignCloudLanguageTaskBuildersToOwner({
    prisma: prisma as never,
    cloudLanguageLibraryId: "cloud_lib_zh",
    ownerUserId: "cloud_user_zh",
  });

  assert.equal(result.updatedBuilders, 1);
  assert.deepEqual(updates[0], {
    where: { id: "builder_old_owner" },
    data: {
      ownerUserId: "cloud_user_zh",
      libraryKey: "user:cloud_user_zh:BLOG:https://example.com/feed.xml",
    },
  });
});

test("cloud language system-owner save refreshes the Hub share when enabled", () => {
  const library = readFileSync("src/lib/cloud-source-library.ts", "utf8");

  assert.match(library, /upsertCloudLanguageLibraryWithSystemOwner/);
  assert.match(library, /if \(!params\.enabled\) return library/);
  assert.match(library, /syncCloudLanguageLibraryHub\(params\.summaryLanguage, prisma\)/);
  assert.match(library, /hubEntry:\s*\{\s*select:\s*\{\s*id:\s*true,\s*slug:\s*true,\s*name:\s*true\s*\}/);
});

test("cloud submissions auto-create the target language library", () => {
  const library = readFileSync("src/lib/cloud-source-library.ts", "utf8");

  assert.match(library, /ensureCloudLanguageLibraryForSubmission/);
  assert.match(library, /upsertCloudLanguageLibraryWithSystemOwner\(\{[\s\S]*enabled: true/);
  assert.doesNotMatch(library, /const cloudLibrary = await resolveCloudLanguageLibrary\(\{[\s\S]*submitUserPrivateLibraryToCloud/);
});

test("cloud source candidate upsert dedupes by canonical source key", async () => {
  const prisma = {
    builder: {
      async findUnique() {
        return {
          id: "builder_zh",
          canonicalKey: "blog:https://example.com/feed",
          name: "Example Feed",
          sourceType: "blog",
          sourceUrl: "https://example.com/feed",
          fetchUrl: "https://example.com/feed",
          handle: null,
          avatarUrl: "https://example.com/favicon.png",
          avatarDataUrl: null,
        };
      },
    },
    sourceCandidate: {
      upsertCalls: [] as unknown[],
      async upsert(args: unknown) {
        this.upsertCalls.push(args);
        return args;
      },
    },
  };

  await upsertSourceCandidateFromCloudBuilder("builder_zh", prisma);

  assert.deepEqual(prisma.sourceCandidate.upsertCalls[0], {
    where: { sourceKey: "blog:https://example.com/feed" },
    update: {
      name: "Example Feed",
      sourceType: "blog",
      sourceUrl: "https://example.com/feed",
      fetchUrl: "https://example.com/feed",
      handle: null,
      avatarUrl: "https://example.com/favicon.png",
      avatarDataUrl: null,
      seedBuilderId: "builder_zh",
      seededFrom: "cloud_source_library",
    },
    create: {
      sourceKey: "blog:https://example.com/feed",
      name: "Example Feed",
      sourceType: "blog",
      sourceUrl: "https://example.com/feed",
      fetchUrl: "https://example.com/feed",
      handle: null,
      avatarUrl: "https://example.com/favicon.png",
      avatarDataUrl: null,
      seedBuilderId: "builder_zh",
      seededFrom: "cloud_source_library",
    },
  });
});

test("cloud language backfill script copies featured Hub sources without user submissions", () => {
  const script = readFileSync(
    "scripts/backfill-cloud-language-library-from-admin-library.mts",
    "utf8",
  );

  assert.match(script, /--language/);
  assert.match(script, /--apply/);
  assert.match(script, /dryRun/);
  assert.match(script, /libraryHubEntry\.findFirst/);
  assert.match(script, /isFeatured:\s*true/);
  assert.match(script, /cloudLanguageLibrary\.findUnique/);
  assert.match(script, /copyBuilderToCloudOwner/);
  assert.match(script, /cloudOwnerUserId:\s*cloudLibrary\.ownerUserId/);
  assert.match(script, /--create-tasks/);
  assert.match(script, /recomputeCloudSourceTask/);
  assert.match(script, /syncCloudLanguageLibraryHub/);
  assert.doesNotMatch(script, /cloudSourceSubmission\.(create|upsert)/);
});

test("planSubmissionReconciliation deactivates active submissions not in the new set", () => {
  const result = planSubmissionReconciliation({
    existingActive: [
      { id: "sub_keep", cloudBuilderId: "cb_a" },
      { id: "sub_removed", cloudBuilderId: "cb_b" },
      { id: "sub_old_lang", cloudBuilderId: "cb_zh_only" },
    ],
    keepCloudBuilderIds: ["cb_a"],
  });

  assert.deepEqual(result.deactivateSubmissionIds.sort(), ["sub_old_lang", "sub_removed"]);
  assert.deepEqual(result.staleCloudBuilderIds.sort(), ["cb_b", "cb_zh_only"]);
});

test("planSubmissionReconciliation keeps everything when the new set covers all active submissions", () => {
  const result = planSubmissionReconciliation({
    existingActive: [
      { id: "sub_a", cloudBuilderId: "cb_a" },
      { id: "sub_b", cloudBuilderId: "cb_b" },
    ],
    keepCloudBuilderIds: ["cb_a", "cb_b", "cb_new"],
  });

  assert.deepEqual(result.deactivateSubmissionIds, []);
  assert.deepEqual(result.staleCloudBuilderIds, []);
});

test("cloud submission upsert refreshes submittedAt when a user resubmits an existing cloud source", () => {
  const library = readFileSync("src/lib/cloud-source-library.ts", "utf8");

  assert.match(library, /cloudSourceSubmission\.upsert\(\{[\s\S]*update: \{[\s\S]*submittedAt: now/);
  assert.match(library, /cloudSourceSubmission\.upsert\(\{[\s\S]*create: \{[\s\S]*submittedAt: now/);
});

test("recomputeCloudSourceTask refreshes schedule fields when reactivating an existing source task", async () => {
  const now = new Date("2026-07-03T15:00:00.000Z");
  const upserts: unknown[] = [];
  const prisma = {
    cloudSourceSubmission: {
      async findMany() {
        return [{ frequency: "DAILY" as const, submittedAt: now }];
      },
    },
    cloudSourceTask: {
      async upsert(args: unknown) {
        upserts.push(args);
        return { id: "task_1" };
      },
    },
  };

  await recomputeCloudSourceTask({
    prisma: prisma as never,
    cloudLanguageLibraryId: "cloud_library_zh",
    builderId: "cloud_builder_1",
    summaryLanguage: "zh",
    now,
  });

  const update = (upserts[0] as { update: Record<string, unknown> }).update;
  assert.equal(update.nextAttemptAt, now);
  assert.equal((update.mustSucceedBy as Date).toISOString(), "2026-07-04T15:00:00.000Z");
});

test("summarizeActiveCloudSubmissions reports effective frequency and most recent language", () => {
  const summary = summarizeActiveCloudSubmissions([
    {
      summaryLanguage: "zh",
      frequency: "WEEKLY",
      submittedAt: new Date("2026-06-20T00:00:00.000Z"),
    },
    {
      summaryLanguage: "zh",
      frequency: "DAILY",
      submittedAt: new Date("2026-06-24T00:00:00.000Z"),
    },
  ]);

  assert.equal(summary.hasActiveSubmission, true);
  assert.equal(summary.activeSourceCount, 2);
  assert.equal(summary.frequency, "DAILY");
  assert.equal(summary.summaryLanguage, "zh");
  assert.deepEqual(summary.lastSubmittedAt, new Date("2026-06-24T00:00:00.000Z"));
});

test("summarizeActiveCloudSubmissions reports no submission for an empty set", () => {
  assert.deepEqual(summarizeActiveCloudSubmissions([]), {
    hasActiveSubmission: false,
    activeSourceCount: 0,
    summaryLanguage: null,
    frequency: null,
    lastSubmittedAt: null,
  });
});

test("getUserCloudSubmissionSummary reads only the user's active submissions", async () => {
  const calls: unknown[] = [];
  const prisma = {
    cloudSourceSubmission: {
      async findMany(args: unknown) {
        calls.push(args);
        return [
          {
            summaryLanguage: "en",
            frequency: "WEEKLY" as const,
            submittedAt: new Date("2026-06-25T00:00:00.000Z"),
          },
        ];
      },
    },
  };

  const summary = await getUserCloudSubmissionSummary({ userId: "user_1", prisma });

  assert.deepEqual(calls[0], {
    where: { userId: "user_1", active: true },
    select: { summaryLanguage: true, frequency: true, submittedAt: true },
  });
  assert.equal(summary.hasActiveSubmission, true);
  assert.equal(summary.summaryLanguage, "en");
  assert.equal(summary.frequency, "WEEKLY");
});

test("stopUserCloudSourceSubmissions deactivates the user's cloud submissions and cancels paused queued tasks", async () => {
  const calls: unknown[] = [];
  const hubSyncs: string[] = [];
  const prisma = {
    cloudSourceSubmission: {
      async findMany(args: unknown) {
        calls.push(["cloudSourceSubmission.findMany", args]);
        const where = (args as { where?: { userId?: string; cloudBuilderId?: string } }).where;
        if (where?.userId) {
          return [
            { id: "sub_a", cloudBuilderId: "cloud_builder_a", summaryLanguage: "zh" },
            { id: "sub_b", cloudBuilderId: "cloud_builder_b", summaryLanguage: "zh" },
          ];
        }
        return [];
      },
      async updateMany(args: unknown) {
        calls.push(["cloudSourceSubmission.updateMany", args]);
        return { count: 2 };
      },
    },
    cloudSourceTask: {
      async findMany(args: unknown) {
        calls.push(["cloudSourceTask.findMany", args]);
        const where = (args as { where?: { builderId?: unknown; id?: unknown } }).where;
        if (where?.builderId) {
          return [
            {
              id: "task_a",
              builderId: "cloud_builder_a",
              cloudLanguageLibraryId: "cloud_library_zh",
              summaryLanguage: "zh",
            },
          ];
        }
        if (where?.id) return [{ id: "task_a" }];
        return [];
      },
      async updateMany(args: unknown) {
        calls.push(["cloudSourceTask.updateMany", args]);
        return { count: 1 };
      },
    },
    cloudFetchQueueItem: {
      async updateMany(args: unknown) {
        calls.push(["cloudFetchQueueItem.updateMany", args]);
        return { count: 1 };
      },
    },
  };

  const result = await stopUserCloudSourceSubmissions({
    userId: "user_1",
    prisma: prisma as never,
    now: new Date("2026-07-03T00:00:00.000Z"),
    syncHub: async (summaryLanguage) => {
      hubSyncs.push(summaryLanguage);
      return {} as never;
    },
  });

  assert.deepEqual(result, { stoppedSources: 2, cancelledQueuedTasks: 1 });
  assert.deepEqual(calls[1], [
    "cloudSourceSubmission.updateMany",
    {
      where: { id: { in: ["sub_a", "sub_b"] } },
      data: { active: false },
    },
  ]);
  assert.ok(
    calls.some(
      (call) =>
        Array.isArray(call) &&
        call[0] === "cloudSourceTask.updateMany" &&
        JSON.stringify(call[1]).includes('"status":"PAUSED"'),
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        Array.isArray(call) &&
        call[0] === "cloudFetchQueueItem.updateMany" &&
        JSON.stringify(call[1]).includes('"cloudSourceTaskId"'),
    ),
  );
  assert.deepEqual(hubSyncs, ["zh"]);
});
