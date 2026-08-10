import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CloudFetchQueueStatus, CloudFetchRunStatus } from "@prisma/client";

import {
  buildPendingCloudFetchSnapshot,
  getPendingCloudFetchSources,
} from "../src/lib/cloud-fetch-pending-sources";
import {
  calculateCloudFetchLeaseBudget,
  estimateCloudFetchTaskTokens,
} from "../src/lib/cloud-source-scheduler";

const now = new Date("2026-08-10T18:00:00.000Z");
const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

type PendingTaskOverrides = Partial<Parameters<typeof buildPendingCloudFetchSnapshot>[0]["tasks"][number]>;

function pendingTask(overrides: PendingTaskOverrides = {}) {
  const builderId = overrides.builderId ?? overrides.builder?.id ?? `builder_${overrides.id ?? "task"}`;
  return {
    id: overrides.id ?? "task",
    builderId,
    summaryLanguage: overrides.summaryLanguage ?? "en",
    effectiveFrequency: overrides.effectiveFrequency ?? "DAILY",
    consecutiveDeferrals: overrides.consecutiveDeferrals ?? 0,
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
    estimatedDurationSeconds: overrides.estimatedDurationSeconds ?? null,
    estimatedTokenCost:
      overrides.estimatedTokenCost === undefined ? 80_000 : overrides.estimatedTokenCost,
    estimatedSuccessProbability: overrides.estimatedSuccessProbability ?? 0.9,
    estimatedPostYield: overrides.estimatedPostYield ?? 3,
    durationP75Seconds: overrides.durationP75Seconds ?? null,
    durationP90Seconds: overrides.durationP90Seconds ?? null,
    durationSampleCount: overrides.durationSampleCount ?? 0,
    successSampleCount: overrides.successSampleCount ?? 0,
    circuitBreakerUntil: overrides.circuitBreakerUntil ?? null,
    nextAttemptAt: overrides.nextAttemptAt ?? now,
    mustSucceedBy: overrides.mustSucceedBy ?? minutesFromNow(120),
    lastSuccessAt: overrides.lastSuccessAt ?? null,
    lastDeferredAt: overrides.lastDeferredAt ?? null,
    builder: {
      id: overrides.builder?.id ?? builderId,
      name: overrides.builder?.name ?? `Builder ${overrides.id ?? "task"}`,
      canonicalKey:
        overrides.builder?.canonicalKey
        ?? `BLOG:https://example.com/${overrides.id ?? "task"}`,
      sourceType: overrides.builder?.sourceType ?? "blog",
    },
  };
}

test("buildPendingCloudFetchSnapshot classifies a null-estimate due youtube task as token_budget", () => {
  const snapshot = buildPendingCloudFetchSnapshot({
    now,
    requestedLimit: 5,
    config: {
      tokenBudgetPerHour: 1_000_000,
      starvationReserveRatio: 0.15,
      leaseTtlMinutes: 60,
      schedulingLeadMinutes: 120,
      retryBaseMinutes: 30,
      failureCircuitBreakerThreshold: 5,
      canonicalCooldownMinutes: 60,
      durationColdStartBufferRatio: 0.5,
    },
    tasks: [
      pendingTask({
        id: "youtube_budget",
        estimatedTokenCost: null,
        consecutiveDeferrals: 8,
        builder: {
          id: "builder_youtube_budget",
          name: "YouTube Budget",
          canonicalKey: "YOUTUBE:https://youtube.com/@budget",
          sourceType: "youtube",
        },
      }),
    ],
    activeSubmissionCounts: { builder_youtube_budget: 1 },
    queueItems: [],
    recentRunTasks: [],
    recentUsageTokens: 939_325,
  });

  assert.deepEqual(snapshot.budget, {
    tokenBudgetPerHour: 1_000_000,
    recentUsageTokens: 939_325,
    activeEstimatedTokens: 0,
    remainingTokens: 60_675,
  });
  assert.equal(snapshot.sources.length, 1);
  assert.deepEqual(snapshot.sources[0], {
    taskId: "youtube_budget",
    builderId: "builder_youtube_budget",
    summaryLanguage: "en",
    sourceType: "youtube",
    name: "YouTube Budget",
    canonicalKey: "YOUTUBE:https://youtube.com/@budget",
    reason: "token_budget",
    estimatedTokens: 120_000,
    consecutiveDeferrals: 8,
    consecutiveFailures: 0,
    lastDeferredAt: null,
    nextAttemptAt: now.toISOString(),
    circuitBreakerUntil: null,
  });
});

test("buildPendingCloudFetchSnapshot reports all pending reasons and excludes non-pending work", () => {
  const leasedCanonical = "BLOG:https://example.com/leased";
  const cooldownCanonical = "BLOG:https://example.com/cooldown";
  const snapshot = buildPendingCloudFetchSnapshot({
    now,
    requestedLimit: 1,
    config: {
      tokenBudgetPerHour: 500_000,
      starvationReserveRatio: 0,
      leaseTtlMinutes: 60,
      schedulingLeadMinutes: 120,
      retryBaseMinutes: 30,
      failureCircuitBreakerThreshold: 5,
      canonicalCooldownMinutes: 60,
      durationColdStartBufferRatio: 0.5,
    },
    tasks: [
      pendingTask({
        id: "queued_task",
        consecutiveDeferrals: 5,
        lastDeferredAt: new Date("2026-08-10T17:30:00.000Z"),
        builder: { id: "builder_queued", name: "Queued Source", canonicalKey: "BLOG:https://example.com/queued", sourceType: "blog" },
      }),
      pendingTask({
        id: "circuit_task",
        consecutiveDeferrals: 4,
        lastDeferredAt: new Date("2026-08-10T17:20:00.000Z"),
        circuitBreakerUntil: minutesFromNow(45),
        builder: { id: "builder_circuit", name: "Circuit Source", canonicalKey: "BLOG:https://example.com/circuit", sourceType: "blog" },
      }),
      pendingTask({
        id: "retry_task",
        consecutiveDeferrals: 3,
        consecutiveFailures: 1,
        lastDeferredAt: new Date("2026-08-10T17:10:00.000Z"),
        nextAttemptAt: minutesFromNow(15),
        builder: { id: "builder_retry", name: "Retry Source", canonicalKey: "BLOG:https://example.com/retry", sourceType: "blog" },
      }),
      pendingTask({
        id: "leased_task",
        builder: { id: "builder_leased", name: "Leased Source", canonicalKey: leasedCanonical, sourceType: "blog" },
      }),
      pendingTask({
        id: "canonical_active_task",
        consecutiveDeferrals: 2,
        lastDeferredAt: new Date("2026-08-10T17:00:00.000Z"),
        builder: { id: "builder_canonical_active", name: "Canonical Active Source", canonicalKey: leasedCanonical, sourceType: "blog" },
      }),
      pendingTask({
        id: "cooldown_task",
        consecutiveDeferrals: 1,
        lastDeferredAt: new Date("2026-08-10T16:50:00.000Z"),
        builder: { id: "builder_cooldown", name: "Cooldown Source", canonicalKey: cooldownCanonical, sourceType: "blog" },
      }),
      pendingTask({
        id: "selected_task",
        estimatedTokenCost: 40_000,
        builder: { id: "builder_selected", name: "Selected Source", canonicalKey: "BLOG:https://example.com/selected", sourceType: "blog" },
      }),
      pendingTask({
        id: "capacity_task",
        consecutiveDeferrals: 7,
        lastDeferredAt: new Date("2026-08-10T17:40:00.000Z"),
        estimatedTokenCost: 40_000,
        builder: { id: "builder_capacity", name: "Capacity Source", canonicalKey: "BLOG:https://example.com/capacity", sourceType: "blog" },
      }),
      pendingTask({
        id: "future_success_task",
        nextAttemptAt: minutesFromNow(120),
        consecutiveFailures: 0,
        builder: { id: "builder_future_success", name: "Future Success", canonicalKey: "BLOG:https://example.com/future-success", sourceType: "blog" },
      }),
      pendingTask({
        id: "inactive_demand_task",
        builder: { id: "builder_inactive", name: "Inactive Demand", canonicalKey: "BLOG:https://example.com/inactive", sourceType: "blog" },
      }),
    ],
    activeSubmissionCounts: {
      builder_queued: 1,
      builder_circuit: 1,
      builder_retry: 1,
      builder_leased: 1,
      builder_canonical_active: 1,
      builder_cooldown: 1,
      builder_selected: 5,
      builder_capacity: 1,
      builder_future_success: 1,
      builder_inactive: 0,
    },
    queueItems: [
      {
        cloudSourceTaskId: "queued_task",
        status: CloudFetchQueueStatus.QUEUED,
        dueAt: now,
        leaseExpiresAt: null,
      },
      {
        cloudSourceTaskId: "leased_task",
        status: CloudFetchQueueStatus.LEASED,
        dueAt: now,
        leaseExpiresAt: minutesFromNow(30),
      },
    ],
    recentRunTasks: [
      {
        cloudSourceTaskId: "recent_cooldown_run",
        canonicalKey: cooldownCanonical,
        status: CloudFetchRunStatus.SUCCEEDED,
        startedAt: new Date("2026-08-10T17:45:00.000Z"),
        usageTokens: 10_000,
      },
    ],
    recentUsageTokens: 10_000,
  });

  assert.deepEqual(
    snapshot.sources.map((source) => [source.taskId, source.reason]),
    [
      ["queued_task", "queued"],
      ["circuit_task", "circuit_breaker"],
      ["retry_task", "retry_backoff"],
      ["canonical_active_task", "canonical_active"],
      ["cooldown_task", "canonical_cooldown"],
      ["capacity_task", "scheduler_capacity"],
    ],
  );
  assert.equal(snapshot.sources.some((source) => source.taskId === "selected_task"), false);
  assert.equal(snapshot.sources.some((source) => source.taskId === "leased_task"), false);
  assert.equal(snapshot.sources.some((source) => source.taskId === "future_success_task"), false);
  assert.equal(snapshot.sources.some((source) => source.taskId === "inactive_demand_task"), false);
});

test("buildPendingCloudFetchSnapshot classifies an individually affordable deferred task as scheduler_capacity", () => {
  const snapshot = buildPendingCloudFetchSnapshot({
    now,
    requestedLimit: 2,
    config: {
      tokenBudgetPerHour: 100_000,
      starvationReserveRatio: 0,
      leaseTtlMinutes: 60,
      schedulingLeadMinutes: 120,
      retryBaseMinutes: 30,
      failureCircuitBreakerThreshold: 5,
      canonicalCooldownMinutes: 60,
      durationColdStartBufferRatio: 0.5,
    },
    tasks: [
      pendingTask({
        id: "selected_due_task",
        estimatedTokenCost: 60_000,
        mustSucceedBy: minutesFromNow(15),
        builder: {
          id: "builder_selected_due",
          name: "Selected Due Task",
          canonicalKey: "BLOG:https://example.com/selected-due",
          sourceType: "blog",
        },
      }),
      pendingTask({
        id: "deferred_due_task",
        estimatedTokenCost: 60_000,
        builder: {
          id: "builder_deferred_due",
          name: "Deferred Due Task",
          canonicalKey: "BLOG:https://example.com/deferred-due",
          sourceType: "blog",
        },
      }),
    ],
    activeSubmissionCounts: {
      builder_selected_due: 1,
      builder_deferred_due: 1,
    },
    queueItems: [],
    recentRunTasks: [],
    recentUsageTokens: 0,
  });

  assert.deepEqual(snapshot.budget, {
    tokenBudgetPerHour: 100_000,
    recentUsageTokens: 0,
    activeEstimatedTokens: 0,
    remainingTokens: 100_000,
  });
  assert.deepEqual(
    snapshot.sources.map((source) => ({
      taskId: source.taskId,
      reason: source.reason,
      estimatedTokens: source.estimatedTokens,
    })),
    [
      {
        taskId: "deferred_due_task",
        reason: "scheduler_capacity",
        estimatedTokens: 60_000,
      },
    ],
  );
});

test("getPendingCloudFetchSources loads scheduler inputs with config defaults and query boundaries", async () => {
  const taskArgs: Array<Record<string, unknown>> = [];
  const queueArgs: Array<Record<string, unknown>> = [];
  const runTaskArgs: Array<Record<string, unknown>> = [];
  const submissionArgs: Array<Record<string, unknown>> = [];
  const prisma = {
    cloudFetchConfig: {
      findUnique: async () => null,
    },
    cloudSourceTask: {
      findMany: async (args: Record<string, unknown>) => {
        taskArgs.push(args);
        return [
          pendingTask({
            id: "youtube_budget",
            estimatedTokenCost: null,
            consecutiveDeferrals: 8,
            builder: {
              id: "builder_youtube_budget",
              name: "YouTube Budget",
              canonicalKey: "YOUTUBE:https://youtube.com/@budget",
              sourceType: "youtube",
            },
          }),
        ];
      },
    },
    cloudSourceSubmission: {
      groupBy: async (args: Record<string, unknown>) => {
        submissionArgs.push(args);
        return [{ cloudBuilderId: "builder_youtube_budget", _count: { _all: 1 } }];
      },
    },
    cloudFetchQueueItem: {
      findMany: async (args: Record<string, unknown>) => {
        queueArgs.push(args);
        return [];
      },
    },
    cloudFetchRunTask: {
      findMany: async (args: Record<string, unknown>) => {
        runTaskArgs.push(args);
        if (runTaskArgs.length === 1) {
          return [{ usageTokens: 939_325 }];
        }
        return [];
      },
    },
  };

  const snapshot = await getPendingCloudFetchSources({
    prisma: prisma as never,
    now,
  });

  assert.equal(snapshot.budget.tokenBudgetPerHour, 1_000_000);
  assert.equal(snapshot.sources[0]?.reason, "token_budget");
  assert.equal(snapshot.sources[0]?.estimatedTokens, 120_000);
  assert.equal(taskArgs.length, 1);
  assert.deepEqual(taskArgs[0]?.where, {
    status: "ACTIVE",
    cloudLanguageLibrary: { enabled: true },
  });
  assert.deepEqual(submissionArgs[0]?.where, {
    cloudBuilderId: { in: ["builder_youtube_budget"] },
    active: true,
  });
  assert.equal(queueArgs.length, 2);
  assert.deepEqual(queueArgs[0]?.where, {
    status: "LEASED",
    leaseExpiresAt: { gt: now },
  });
  assert.deepEqual(queueArgs[1]?.where, {
    cloudSourceTaskId: { in: ["youtube_budget"] },
    status: "QUEUED",
  });
  assert.equal(runTaskArgs.length, 2);
  assert.deepEqual(runTaskArgs[0]?.where, {
    startedAt: { gte: new Date("2026-08-10T17:00:00.000Z") },
  });
  assert.deepEqual(runTaskArgs[1]?.where, {
    startedAt: { gte: new Date("2026-08-10T17:00:00.000Z") },
  });
});

test("getPendingCloudFetchSources treats an out-of-scope active lease as canonical_active", async () => {
  const queueArgs: Array<Record<string, unknown>> = [];
  const prisma = {
    cloudFetchConfig: { findUnique: async () => null },
    cloudSourceTask: {
      findMany: async () => [
        pendingTask({
          id: "candidate_task",
          consecutiveDeferrals: 4,
          builder: {
            id: "builder_candidate",
            name: "Candidate Source",
            canonicalKey: "BLOG:https://example.com/shared-canonical",
            sourceType: "blog",
          },
        }),
      ],
    },
    cloudSourceSubmission: {
      groupBy: async () => [{ cloudBuilderId: "builder_candidate", _count: { _all: 1 } }],
    },
    cloudFetchQueueItem: {
      findMany: async (args: Record<string, unknown>) => {
        queueArgs.push(args);
        if ((args.where as { status?: string })?.status === "LEASED") {
          return [
            {
              cloudSourceTaskId: "out_of_scope_leased_task",
              status: CloudFetchQueueStatus.LEASED,
              dueAt: now,
              leaseExpiresAt: minutesFromNow(30),
              cloudSourceTask: {
                estimatedTokenCost: 90_000,
                builder: {
                  canonicalKey: "BLOG:https://example.com/shared-canonical",
                  sourceType: "blog",
                },
              },
            },
          ];
        }
        return [];
      },
    },
    cloudFetchRunTask: {
      findMany: async () => [],
    },
  };

  const snapshot = await getPendingCloudFetchSources({
    prisma: prisma as never,
    now,
  });

  assert.deepEqual(snapshot.sources.map((source) => [source.taskId, source.reason]), [
    ["candidate_task", "canonical_active"],
  ]);
  assert.deepEqual(queueArgs[0]?.where, {
    status: "LEASED",
    leaseExpiresAt: { gt: now },
  });
});

test("getPendingCloudFetchSources counts an out-of-scope active lease against remaining budget", async () => {
  const prisma = {
    cloudFetchConfig: {
      findUnique: async () => ({ tokenBudgetPerHour: 100_000 }),
    },
    cloudSourceTask: {
      findMany: async () => [
        pendingTask({
          id: "budget_candidate",
          estimatedTokenCost: 40_000,
          consecutiveDeferrals: 3,
          builder: {
            id: "builder_budget_candidate",
            name: "Budget Candidate",
            canonicalKey: "BLOG:https://example.com/budget-candidate",
            sourceType: "blog",
          },
        }),
      ],
    },
    cloudSourceSubmission: {
      groupBy: async () => [{ cloudBuilderId: "builder_budget_candidate", _count: { _all: 1 } }],
    },
    cloudFetchQueueItem: {
      findMany: async (args: Record<string, unknown>) => {
        if ((args.where as { status?: string })?.status === "LEASED") {
          return [
            {
              cloudSourceTaskId: "out_of_scope_budget_lease",
              status: CloudFetchQueueStatus.LEASED,
              dueAt: now,
              leaseExpiresAt: minutesFromNow(30),
              cloudSourceTask: {
                estimatedTokenCost: 80_000,
                builder: {
                  canonicalKey: "BLOG:https://example.com/out-of-scope",
                  sourceType: "blog",
                },
              },
            },
          ];
        }
        return [];
      },
    },
    cloudFetchRunTask: {
      findMany: async () => [],
    },
  };

  const snapshot = await getPendingCloudFetchSources({
    prisma: prisma as never,
    now,
  });

  assert.deepEqual(snapshot.budget, {
    tokenBudgetPerHour: 100_000,
    recentUsageTokens: 0,
    activeEstimatedTokens: 80_000,
    remainingTokens: 20_000,
  });
  assert.deepEqual(snapshot.sources.map((source) => [source.taskId, source.reason]), [
    ["budget_candidate", "token_budget"],
  ]);
});

test("cloud-fetch-pending-sources query contract preserves scheduler boundaries", () => {
  const source = readFileSync(
    new URL("../src/lib/cloud-fetch-pending-sources.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /status:\s*"ACTIVE"/);
  assert.match(source, /cloudLanguageLibrary:\s*\{\s*enabled:\s*true\s*\}/);
  assert.match(source, /active:\s*true/);
  assert.match(source, /status:\s*"QUEUED"/);
  assert.match(source, /status:\s*"LEASED"/);
  assert.match(source, /leaseExpiresAt:\s*\{\s*gt:\s*params\.now\s*\}/);
  assert.match(source, /cloudSourceTaskId:\s*\{\s*in:\s*taskIds\s*\}/);
  assert.match(source, /oneHourAgo/);
  assert.match(source, /cooldownStartedAt/);
});

test("scheduler budget helpers preserve token priors and normalized remaining budget", () => {
  assert.equal(
    estimateCloudFetchTaskTokens({ estimatedTokenCost: null, sourceType: "youtube" }),
    120_000,
  );
  assert.deepEqual(
    calculateCloudFetchLeaseBudget({
      tokenBudgetPerHour: 1_000_000,
      recentUsageTokens: 939_325,
      activeEstimatedTokens: 0,
      requestedLimit: 999,
    }),
    {
      limit: 100,
      tokenBudget: 60_675,
      tokenBudgetPerHour: 1_000_000,
      recentUsageTokens: 939_325,
      activeEstimatedTokens: 0,
    },
  );
});
