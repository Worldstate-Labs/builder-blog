import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildWorkerShardGroupsForTest } from "../src/components/AdminCloudFetchLog";
import { classifyCloudSourceLifecycleForTest } from "../src/components/CloudSourceLogItem";
import type {
  CloudFetchPostOutcome,
  CloudFetchRunLogItem,
  CloudFetchRunLogTask,
  CloudWorkerHostTask,
} from "../src/lib/cloud-fetch-run-log";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

function cloudSourceTask(overrides: Partial<CloudFetchRunLogTask> = {}): CloudFetchRunLogTask {
  return {
    id: "source_task",
    builderId: "builder_1",
    sourceName: "Source",
    sourceType: "blog",
    summaryLanguage: "source",
    status: "SUCCEEDED",
    startedAt: "2026-08-21T10:00:00.000Z",
    finishedAt: "2026-08-21T10:05:00.000Z",
    plannedPosts: 2,
    syncedPosts: 1,
    failedPosts: 1,
    skippedPosts: 0,
    pendingPosts: 0,
    durationMs: 300000,
    estimatedDurationSeconds: null,
    mustSucceedBy: null,
    provisionalExecutionBudgetSeconds: null,
    workloadClass: null,
    budgetReason: null,
    deadlineState: null,
    successProbability: null,
    usageTokens: null,
    usageCostUsd: null,
    failureReason: "task_sync_failed",
    posts: [],
    workerUsages: [],
    noGeneratedFetchTasks: false,
    ...overrides,
  };
}

test("admin cloud fetch runs route is admin-gated and serializes worker host plus source deliveries", () => {
  const route = source("src/app/api/admin/cloud-fetch/runs/route.ts");
  const handler = source("src/lib/cloud-fetch-runs-handler.ts");

  assert.match(route, /createCloudFetchRunsGetHandler/);
  assert.match(route, /export const GET = createCloudFetchRunsGetHandler\(/);
  assert.match(route, /requireCloudFetchAdmin/);
  assert.match(route, /serializeCloudFetchRun/);
  assert.match(route, /serializeCloudWorkerHost/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(handler, /return NextResponse\.json\(\{ error: auth\.error \}/);
  assert.match(handler, /listCloudFetchRuns/);
  assert.match(handler, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(handler, /leaseBatches/);
  assert.match(handler, /workerHost/);
  assert.match(handler, /builder: \{ select: \{ name: true, sourceType: true \} \}/);
});

test("cloud-library management page is admin-gated and mounts the cloud monitor sections", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");

  assert.match(page, /isAdminEmail/);
  assert.match(page, /redirect\(/);
  assert.match(page, /AdminCloudFetchRunActions/);
  assert.match(page, /AdminCloudFetchLog/);
  assert.match(page, /Cloud fetch monitor/);
  assert.match(page, /AdminCloudLibraryMaintenancePanel/);
  // The scheduler config form was moved here from the main Settings page.
  assert.match(page, /AdminCloudFetchConfigForm/);
  assert.match(page, /CLOUD_FETCH_CONFIG_ID/);
});

test("cloud-library management page loads and passes initial pending source diagnostics", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");

  assert.match(page, /getPendingCloudFetchSources/);
  assert.match(page, /const \[[\s\S]*initialPendingSources[\s\S]*\] = await Promise\.all\(\[/);
  assert.match(page, /Promise\.all\(\[[\s\S]*getPendingCloudFetchSources\(\{[\s\S]*prisma[\s\S]*now: new Date\(\)[\s\S]*\}\),[\s\S]*\]\)/);
  assert.match(
    page,
    /<AdminCloudFetchLog[\s\S]*initialWorkerHost=\{workerHost\}[\s\S]*initialLeaseBatches=\{leaseBatches\}[\s\S]*initialHasMore=\{hasMore\}[\s\S]*initialPendingSources=\{initialPendingSources\}/,
  );
  assert.doesNotMatch(page, /<AdminCloudFetchLog\s*\{\.\.\.cloudFetchLogProps\}/);
  assert.doesNotMatch(page, /@ts-expect-error/);
});

test("cloud output pools are automatic and only expose pause controls", () => {
  const form = source("src/components/AdminCloudFetchConfigForm.tsx");

  assert.match(form, /Cloud output pools/);
  assert.match(form, /created automatically from Cloud submissions/);
  assert.match(form, /function setLanguageLibraryEnabled/);
  assert.match(form, /summaryLanguage: library\.summaryLanguage/);
  assert.match(form, /library\.enabled \? "Pause" : "Activate"/);
  assert.doesNotMatch(form, /System owner:/);
  assert.doesNotMatch(form, /FieldSelect/);
  assert.doesNotMatch(form, /label="Summary language"/);
  assert.doesNotMatch(form, /label="Output language"/);
  assert.doesNotMatch(form, /Save output library/);
});

test("cloud library maintenance reset is admin-gated and scoped to cloud generated state", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");
  const panel = source("src/components/AdminCloudLibraryMaintenancePanel.tsx");
  const route = source("src/app/api/admin/cloud-fetch/reset/route.ts");
  const helper = source("src/lib/cloud-library-reset.ts");

  assert.match(page, /Cloud library maintenance/);
  assert.match(panel, /Reset Cloud library posts and fetch records/);
  assert.match(panel, /\/api\/admin\/cloud-fetch\/reset/);
  assert.match(panel, /RESET/);
  assert.match(panel, /contentSyncStateChanged/);
  assert.match(panel, /window\.dispatchEvent\(new Event\(contentSyncStateChanged\)\)/);
  assert.match(route, /requireCloudFetchAdmin/);
  assert.match(route, /resetCloudLibraryGeneratedState/);
  assert.match(route, /confirmation[\s\S]*RESET/);
  assert.match(helper, /cloudLanguageLibrary\.findMany/);
  assert.match(helper, /feedItem\.deleteMany\(\{[\s\S]*builderId: \{ in: builderIds \}/);
  assert.match(helper, /cloudFetchQueueItem\.deleteMany\(\{[\s\S]*cloudSourceTaskId: \{ in: sourceTaskIds \}/);
  assert.match(helper, /cloudFetchRunTask\.deleteMany\(\{[\s\S]*cloudSourceTaskId: \{ in: sourceTaskIds \}/);
  assert.match(helper, /cloudFetchRun\.deleteMany\(\)/);
  assert.match(helper, /agentJobRun\.deleteMany\(\{[\s\S]*jobType: "cloud-library-fetch"/);
  assert.match(helper, /cloudSourceSubmission\.groupBy/);
  assert.match(helper, /cloudSourceTask\.updateMany/);
  assert.match(helper, /status: "PAUSED"/);
  assert.match(helper, /builder\.updateMany\(\{[\s\S]*ownerUserId: \{ in: ownerIds \}/);
  assert.doesNotMatch(helper, /cloudSourceSubmission\.deleteMany/);
  assert.doesNotMatch(helper, /cloudLanguageLibrary\.deleteMany/);
});

test("settings page links to the cloud library management route for admins", () => {
  const page = source("src/app/(workspace)/settings/page.tsx");

  assert.match(page, /\/settings\/cloud-library/);
});

test("copy-prompt jobs for cloud worker host setup and stop are whitelisted", () => {
  const jobs = source("src/lib/skill-job-files.ts");

  assert.match(jobs, /"cloud-library-cron-setup":/);
  assert.match(jobs, /"cloud-library-cron-stop":/);
  assert.match(jobs, /"cloud-library-host":/);
  assert.doesNotMatch(jobs, /"cloud-library-once":/);
});

test("cloud run actions component copies worker host and stop prompts via short prompt links", () => {
  const actions = source("src/components/AdminCloudFetchRunActions.tsx");
  const instruction = source("src/lib/agent-prompt-link-instruction.ts");

  assert.match(actions, /cloud-library-cron-setup/);
  assert.match(actions, /cloud-library-cron-stop/);
  assert.doesNotMatch(actions, /cloud-library-once/);
  assert.match(actions, /\/api\/settings\/tokens\/\$\{tokenId\}\/prompt-links/);
  assert.match(actions, /JSON\.stringify\(\{ job, options \}/);
  assert.match(actions, /options:\s*\{/);
  assert.match(actions, /body:\s*JSON\.stringify/);
  assert.match(actions, /body\?\.url/);
  assert.match(actions, /buildAgentPromptLinkInstruction\(url\)/);
  assert.doesNotMatch(actions, /hermes|Hermes/);
  assert.match(instruction, /If browser access is blocked, use Node\.js fetch instead of curl/);
  assert.doesNotMatch(actions, /exchange-code/);
  assert.doesNotMatch(actions, /\/api\/skill\/jobs\//);
  assert.doesNotMatch(actions, /URLSearchParams/);
  assert.doesNotMatch(actions, /cloud-run-cloud-limit/);
  assert.doesNotMatch(actions, /cloud-run-post-limit/);
  assert.match(actions, /cloud-run-fetch-days/);
  assert.match(actions, /cloud-run-parallel-workers/);
  assert.match(actions, /const PARALLEL_WORKERS_DEFAULT = 10/);
  assert.match(actions, /const PARALLEL_WORKERS_MAX = 20/);
  assert.doesNotMatch(actions, /params\.set\("cloudLimit"/);
  assert.doesNotMatch(actions, /params\.set\("postLimit"/);
  assert.doesNotMatch(actions, /params\.set\("days"/);
  assert.doesNotMatch(actions, /params\.set\("parallel"/);
  assert.doesNotMatch(actions, /params\.set\("freq"/);
  assert.match(actions, /options\.fetchDays = fetchDaysValue/);
  assert.match(actions, /options\.parallelWorkers = parallelWorkersValue/);
});

test("cloud run actions expose host settings without a cadence selector", () => {
  const actions = source("src/components/AdminCloudFetchRunActions.tsx");

  assert.match(actions, /Copy worker host prompt/);
  assert.match(actions, /Copy stop cloud fetch prompt/);
  assert.match(actions, /CLOUD_WORKER_HOST_JOB/);
  assert.match(actions, /CLOUD_WORKER_STOP_JOB/);
  assert.doesNotMatch(actions, /FREQUENCY_OPTIONS/);
  assert.doesNotMatch(actions, /cloud-run-frequency/);
  assert.doesNotMatch(actions, /frequency === "once"/);
});

test("cloud fetch log component reads the admin runs endpoint", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  assert.match(log, /from "@\/lib\/fetch-failure-taxonomy"/);
  assert.match(log, /\/api\/admin\/cloud-fetch\/runs/);
  assert.match(log, /initialWorkerHost/);
  assert.match(log, /initialLeaseBatches/);
  assert.match(log, /workerHost/);
  assert.match(log, /leaseBatches/);
  assert.match(log, /selectUnassignedWorkerTasks/);
  assert.match(log, /selectFailedBeforeAssignmentWorkerTasks/);
  assert.match(log, /formatPreAssignmentFailureMessage/);
  assert.match(log, /formatCloudWorkerTaskLabel/);
  assert.match(log, /resolveWorkerAssignment/);
  assert.match(log, /Waiting for assignment/);
  assert.match(log, /\{waitingTasks\.length\} waiting/);
  assert.match(log, /Failed before assignment/);
  assert.match(log, /\{failedBeforeAssignmentTasks\.length\} failed/);
  assert.match(log, /failedBeforeAssignmentTasks\.length > 0/);
  assert.match(log, /formatPreAssignmentFailureMessage\(task\)/);
  assert.ok(
    log.indexOf("Waiting for assignment") <
      log.indexOf("Failed before assignment"),
  );
  assert.doesNotMatch(
    log,
    /selectUnassignedWorkerTasks\(workerHost\.tasks\)\)\.slice/,
  );
  assert.match(
    log,
    /skippedReasonSummary\(\s*workerHost\.tasks,\s*workerHost\.recentEvents,\s*skippedCount,\s*\)/,
  );
  assert.match(log, /No tasks waiting for assignment\./);
  assert.match(log, /Worker lanes/);
  assert.match(
    log,
    /Each lane is one local worker slot\. Assigned tasks appear here when a worker claims them\./,
  );
  assert.doesNotMatch(log, /No local worker assignment/);
  assert.match(log, /formatInlineUsage\(group\.usage\)/);
  assert.match(log, /formatInlineUsage\(usage\)/);
  assert.match(log, /Source deliveries/);
  assert.match(log, /Host id/);
  assert.match(log, /P\(success\)/);
  assert.match(log, /cache: "no-store"/);
  assert.match(log, /buildWorkerShardGroups/);
  assert.match(log, /fallbackMetrics/);
  assert.match(log, /contentSyncStateChanged/);
  assert.match(log, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(log, /initialPendingSources/);
  assert.match(log, /pendingSources\?: CloudPendingSourceSnapshot \| null/);
  assert.match(log, /useState\(initialPendingSources\)/);
  assert.match(log, /useRef\(initialPendingSources\)/);
  assert.match(
    log,
    /liveDataSignature\(\{\s*workerHost: initialWorkerHost,\s*leaseBatches: initialLeaseBatches,\s*pendingSources: initialPendingSources,\s*\}\)/,
  );
  assert.match(log, /body\?\.pendingSources !== null/);
  assert.match(log, /pendingSourcesRef\.current = body\.pendingSources/);
  assert.match(log, /setPendingSources\(body\.pendingSources\)/);
  assert.match(log, /pendingSources: body\?\.pendingSources !== null[\s\S]*pendingSourcesRef\.current/);
  assert.match(log, /This source is still running\. Post task outcomes appear after/);
  assert.match(log, /task\.plannedPosts === 0 &&[\s\S]*!task\.noGeneratedFetchTasks[\s\S]*!task\.finishedAt/);
  assert.match(log, /function formatPostOutcomeSummary\(\{[\s\S]*status/);
  assert.match(log, /planned > 0[\s\S]*Running without post tasks/);
  assert.match(log, /Failed before post planning/);
  assert.doesNotMatch(log, /entry\.liveTask\?\.status \?\? entry\.task\.status/);
  assert.match(log, /resolveCloudWorkerTaskStatus/);
  assert.match(log, /summarizeCloudWorkerLaneStatuses/);
  assert.match(log, /actionNeeded/);
  assert.match(log, /ACTION NEEDED/);
  assert.match(log, /SKIPPED/);
  assert.match(log, /No post tasks were generated for this source/);
  assert.match(log, /emptySourceTaskMessage/);
  assert.match(log, /tasksClaimed/);
  assert.match(log, /pendingPosts/);
  assert.match(log, /function runtimeLabel/);
  assert.match(log, /workerHost\.runtime && workerHost\.model/);
  assert.match(log, /function skippedReasonSummary/);
  assert.match(log, /skippedReasonLabel/);
  assert.match(log, /Completed \/ planned/);
  assert.match(log, /Initial budget/);
  assert.match(log, /Deadline risk/);
  assert.match(log, /Must succeed by/);
  assert.match(log, /Historical estimate/);
  assert.match(log, /Historical P\(success\)/);
  assert.match(log, /workerHost\.hostname,\s*runtimeLabel\(workerHost\),/);
  assert.doesNotMatch(log, /workerHost\.platform,/);
  assert.doesNotMatch(log, /claimed\s*\{/);
  assert.doesNotMatch(log, /disabled=\{!hasPosts\}/);
  assert.doesNotMatch(log, /<strong>Estimated<\/strong>/);
  assert.doesNotMatch(log, /<strong>P\(success\)<\/strong>/);
});

test("cloud fetch log surfaces zero-post failure facts instead of treating them as no-post success", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  assert.match(log, /emptySourceTaskMessage\(task: CloudFetchRunLogTask\)/);
  assert.match(log, /fetchFailureInfo\(task\.failureReason\)/);
  assert.match(log, /const failedBeforePostPlanning =/);
  assert.match(log, /Failed before post planning/);
  assert.match(log, /<strong>Failure<\/strong>/);
  assert.match(log, /<strong>Code<\/strong>/);
});

test("cloud fetch log renders pending source lease diagnostics before waiting assignment", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  assert.match(log, /Waiting for source lease/);
  assert.match(log, /pendingSources\.sources\.length\} waiting/);
  assert.match(log, /No sources waiting for lease\./);
  assert.match(
    log,
    /Waiting for source lease[\s\S]*Waiting for assignment/,
  );
  assert.match(log, /<WorkerHostPanel[\s\S]*pendingSources=\{pendingSources\}/);
  assert.match(log, /cloud-worker-task-section/);
  assert.match(log, /cloud-worker-task-list/);
  assert.match(log, /cloud-worker-task-row/);
  assert.match(log, /cloud-worker-task-main/);
  assert.match(log, /cloud-worker-task-title/);
  assert.match(log, /cloud-worker-task-meta/);
  assert.match(log, /cloud-worker-task-message/);
});

test("cloud fetch log shows reason-specific pending source copy plus token and time diagnostics", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  assert.match(log, /Queued for lease/);
  assert.match(log, /Ready for lease/);
  assert.match(log, /Circuit breaker delay/);
  assert.match(log, /Retry delay/);
  assert.match(log, /Canonical source active/);
  assert.match(log, /Canonical cooldown/);
  assert.match(log, /Token budget gate/);
  assert.match(log, /Scheduler capacity/);
  assert.match(log, /Queued and waiting for a worker lease\./);
  assert.match(log, /Due and within budget; waiting for the worker's next lease request\./);
  assert.match(log, /Waiting for the circuit breaker delay to expire\./);
  assert.match(log, /Waiting for the retry delay to expire\./);
  assert.match(log, /Another active lease already owns this canonical source\./);
  assert.match(log, /Recent canonical activity is still cooling down\./);
  assert.match(log, /Needs more estimated tokens than remain in the rolling hourly window\./);
  assert.match(log, /Due now and within budget, waiting for the scheduler's next selection pass\./);
  assert.match(log, /Estimated /);
  assert.match(log, /Remaining /);
  assert.match(log, /Deferrals /);
  assert.match(log, /Last deferred/);
  assert.match(log, /Next attempt/);
  assert.match(log, /Circuit until/);
  assert.match(log, /formatUsageTokens\(source\.estimatedTokens\)/);
  assert.match(log, /formatUsageTokens\(pendingSources\.budget\.remainingTokens\)/);
  assert.match(log, /<RelativeTime value=\{source\.lastDeferredAt\}/);
  assert.match(log, /<RelativeTime value=\{source\.nextAttemptAt\}/);
  assert.match(log, /<RelativeTime value=\{source\.circuitBreakerUntil\}/);
});

function cloudPost(
  id: string,
  status: string,
  workerId: string,
): CloudFetchPostOutcome {
  return {
    id,
    title: id,
    url: `https://example.com/${id}`,
    contentStatus: "requires_agent",
    agentWorkType: "fetch_post",
    status,
    failureReason: status === "failed" ? "sync_failed" : null,
    fetchTool: "local agent",
    agentRuntime: "codex",
    model: "test-model",
    bodyChars: null,
    bodyWords: null,
    headlineChars: null,
    headlineWords: null,
    summaryChars: status === "synced" ? 657 : null,
    summaryWords: status === "synced" ? 93 : null,
    readMethod: null,
    summaryMethod: null,
    hubSharedReuse: null,
    workerId,
    estimatedWorkSeconds: null,
    executionBudgetSeconds: null,
    workloadClass: null,
    budgetReason: null,
    deadlineState: null,
    mediaDurationSeconds: null,
    plannedExtractionMethod: null,
    mustSucceedBy: null,
    estimateEvidence: null,
  };
}

function cloudBatch(
  id: string,
  startedAt: string,
  posts: CloudFetchPostOutcome[],
): CloudFetchRunLogItem {
  const synced = posts.filter((post) => post.status === "synced").length;
  const failed = posts.filter((post) => post.status === "failed").length;
  const skipped = posts.filter((post) => post.status === "skipped").length;
  return {
    id,
    leaseOwner: "local-cloud-runner:test-host",
    startedAt,
    finishedAt: null,
    durationMs: null,
    status: "RUNNING",
    requestedLimit: 10,
    tasksClaimed: 1,
    tasksSucceeded: 0,
    tasksPartial: 0,
    tasksFailed: 0,
    tasksRunning: 1,
    plannedPosts: posts.length,
    syncedPosts: synced,
    failedPosts: failed,
    skippedPosts: skipped,
    pendingPosts: Math.max(0, posts.length - synced - failed - skipped),
    usageTokens: null,
    usageCostUsd: null,
    summary: null,
    tasks: [
      {
        id: `${id}-source`,
        builderId: "builder",
        sourceName: "Source",
        sourceType: "blog",
        summaryLanguage: "source",
        status: "RUNNING",
        startedAt,
        finishedAt: null,
        plannedPosts: posts.length,
        syncedPosts: synced,
        failedPosts: failed,
        skippedPosts: skipped,
        pendingPosts: Math.max(0, posts.length - synced - failed - skipped),
        durationMs: null,
        estimatedDurationSeconds: null,
        mustSucceedBy: null,
        provisionalExecutionBudgetSeconds: null,
        workloadClass: null,
        budgetReason: null,
        deadlineState: null,
        successProbability: null,
        usageTokens: null,
        usageCostUsd: null,
        failureReason: null,
        posts,
        workerUsages: [],
        noGeneratedFetchTasks: false,
      },
    ],
  };
}

function liveTask(
  id: string,
  status: string,
  workerId: string,
): CloudWorkerHostTask {
  return {
    id,
    status,
    phase: status === "summarized" ? "summarize" : status,
    message: status === "summarized" ? "Summary ready; waiting for server sync." : status,
    reason: null,
    builder: "Source",
    builderId: "builder",
    sourceType: "blog",
    title: id,
    url: `https://example.com/${id}`,
    workerId,
    bodyChars: null,
    bodyWords: null,
    headlineChars: status === "summarized" ? 41 : null,
    headlineWords: status === "summarized" ? 7 : null,
    summaryChars: status === "summarized" ? 657 : null,
    summaryWords: status === "summarized" ? 93 : null,
    updatedAt: "2026-07-31T08:00:00.000Z",
  };
}

test("worker lanes keep the newest persisted terminal result and suppress stale live overlays", () => {
  const newest = cloudBatch(
    "newest",
    "2026-07-31T08:00:00.000Z",
    [cloudPost("post-1", "synced", "worker-10")],
  );
  const older = cloudBatch(
    "older",
    "2026-07-31T07:00:00.000Z",
    [cloudPost("post-1", "pending", "worker-10")],
  );

  const groups = buildWorkerShardGroupsForTest(
    [newest, older],
    [liveTask("post-1", "summarized", "worker-10")],
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].tasks.length, 1);
  assert.equal(groups[0].tasks[0].task.status, "synced");
  assert.equal(groups[0].tasks[0].liveTask, null);
  assert.equal(groups[0].synced, 1);
  assert.equal(groups[0].pending, 0);
  assert.equal(groups[0].status, "synced");
  assert.equal(groups[0].label, "SYNCED");
  assert.equal(groups[0].updatedAt, null);
});

test("worker lanes count four durable syncs and one failure instead of stale heartbeat states", () => {
  const posts = [
    cloudPost("post-1", "synced", "worker-1"),
    cloudPost("post-2", "synced", "worker-1"),
    cloudPost("post-3", "synced", "worker-1"),
    cloudPost("post-4", "synced", "worker-1"),
    cloudPost("post-5", "failed", "worker-1"),
  ];
  const groups = buildWorkerShardGroupsForTest(
    [cloudBatch("production-shape", "2026-07-31T08:00:00.000Z", posts)],
    [
      liveTask("post-3", "summarized", "worker-1"),
      liveTask("post-4", "summarized", "worker-1"),
    ],
  );

  assert.equal(groups.length, 1);
  assert.deepEqual(
    {
      synced: groups[0].synced,
      skipped: groups[0].skipped,
      failed: groups[0].failed,
      actionNeeded: groups[0].actionNeeded,
      pending: groups[0].pending,
      status: groups[0].status,
      label: groups[0].label,
    },
    {
      synced: 4,
      skipped: 0,
      failed: 1,
      actionNeeded: 0,
      pending: 0,
      status: "partial",
      label: "PARTIAL",
    },
  );
});

test("offline worker host presents its retained summary as historical", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  assert.match(
    log,
    /workerHost\.status === "offline" && workerHost\.summary[\s\S]*Last reported:/,
  );
});

test("cloud worker host metrics wrap long stage and usage values", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");
  const styles = source("src/app/globals.css");

  assert.match(log, /cloud-worker-host-metric is-stage/);
  assert.match(log, /cloud-worker-host-metric is-usage/);
  assert.match(styles, /\.cloud-worker-host-metrics \{[\s\S]*display: flex;[\s\S]*flex-wrap: wrap;/);
  assert.match(styles, /\.cloud-worker-host-metric strong \{[^}]*overflow-wrap: anywhere;/);
  assert.match(styles, /\.cloud-worker-host-metric strong \{[^}]*white-space: normal;/);
  assert.doesNotMatch(styles, /\.cloud-worker-host-metric strong \{[^}]*text-overflow: ellipsis;/);
});

test("cloud worker queue titles wrap instead of truncating readable labels", () => {
  const styles = source("src/app/globals.css");
  const rule = styles.match(/\.cloud-worker-task-title \{([^}]*)\}/)?.[1] ?? "";

  assert.match(rule, /overflow-wrap: anywhere;/);
  assert.match(rule, /white-space: normal;/);
  assert.doesNotMatch(rule, /text-overflow: ellipsis;/);
});

test("cloud management timestamps use the shared relative time renderer", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");
  const sourceLogItem = source("src/components/CloudSourceLogItem.tsx");

  for (const component of [log, sourceLogItem]) {
    assert.match(component, /@\/components\/RelativeTime/);
    assert.match(component, /<RelativeTime/);
    assert.doesNotMatch(component, /function format(?:Time|Date)\(/);
    assert.doesNotMatch(component, /Intl\.DateTimeFormat/);
    assert.doesNotMatch(component, /timeZone:\s*"UTC"/);
  }
});

test("cloud fetch log reuses the personal fetch log's per-post staged renderer", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  // Genuine reuse: import and render the personal FetchLogPanel's TaskRow so
  // each cloud post shows the same read → summarize → sync lifecycle and
  // per-stage debug, instead of a bespoke per-post row.
  assert.match(log, /import \{ TaskRow[^}]*\} from "@\/components\/FetchLogPanel"/);
  assert.match(log, /<TaskRow/);
  assert.match(log, /postToFetchTaskLog/);

  // FetchLogPanel exports the shared renderer and the types cloud maps into.
  const panel = source("src/components/FetchLogPanel.tsx");
  assert.match(panel, /export function TaskRow/);
  assert.match(panel, /export type FetchTaskLog/);
  assert.match(panel, /export type FetchTaskProgress/);
});

test("cloud source lifecycle does not treat a running zero-count task as no-posts complete", () => {
  const sourceLogItem = source("src/components/CloudSourceLogItem.tsx");

  assert.match(sourceLogItem, /const stillAwaitingPostResults = running && task\.plannedPosts === 0 && !task\.noGeneratedFetchTasks/);
  assert.match(sourceLogItem, /const zeroPostFailure = task\.plannedPosts === 0 && !running && \(failed \|\| partial\)/);
  assert.match(sourceLogItem, /const noPosts = task\.noGeneratedFetchTasks \|\| \(!running && task\.plannedPosts === 0 && !zeroPostFailure\)/);
  assert.match(sourceLogItem, /meta: stillAwaitingPostResults \? "Waiting for results" : postOutcomeSummary\(task\)/);
  assert.match(sourceLogItem, /function postOutcomeSummary\(task: CloudFetchRunLogTask\) \{[\s\S]*return "Waiting for results"/);
});

test("cloud source lifecycle treats failed zero-post sources as failed before post planning and hides admin-only raw details from users", () => {
  const sourceLogItem = source("src/components/CloudSourceLogItem.tsx");

  assert.match(sourceLogItem, /from "@\/lib\/fetch-failure-taxonomy"/);
  assert.match(sourceLogItem, /const failed = status === "failed"/);
  assert.match(sourceLogItem, /const partial = status === "partial"/);
  assert.match(sourceLogItem, /const zeroPostFailure = task\.plannedPosts === 0 && !running && \(failed \|\| partial\)/);
  assert.match(sourceLogItem, /outcome: zeroPostFailure \? "Failed" : noPosts \? "No posts planned" : failed \? "Failed" : running \? "Running" : "Fetched"/);
  assert.match(sourceLogItem, /outcome: noPosts \|\| zeroPostFailure[\s\S]*"Not reached"/);
  assert.match(sourceLogItem, /showAdminCopy \? lifecycle\.failure\.operatorMessage : lifecycle\.failure\.userMessage/);
  assert.match(sourceLogItem, /<FactRow label="Failure" value=\{lifecycle\.failure\.userMessage\} \/>/);
  assert.match(sourceLogItem, /<FactRow label="Code" value=\{lifecycle\.failure\.code\} \/>/);
  assert.match(sourceLogItem, /No summary exists because source planning failed before any posts were fetched\./);
  assert.match(sourceLogItem, /function postOutcomeSummary\(task: CloudFetchRunLogTask\) \{[\s\S]*"Failed before post planning"/);
  assert.doesNotMatch(sourceLogItem, /providerError/);
});

test("partial source tasks with planned posts keep mixed lifecycle states instead of collapsing to full failure", () => {
  const lifecycle = classifyCloudSourceLifecycleForTest(
    cloudSourceTask({
      status: "PARTIAL",
      plannedPosts: 3,
      syncedPosts: 2,
      failedPosts: 1,
      pendingPosts: 0,
      noGeneratedFetchTasks: false,
      failureReason: "task_sync_failed",
    }),
  );

  assert.equal(lifecycle.failed, false);
  assert.equal(lifecycle.partial, true);
  assert.equal(lifecycle.zeroPostFailure, false);
  assert.deepEqual(
    lifecycle.steps.map((step) => [step.key, step.outcome, step.tone]),
    [
      ["planned", "Source task", "ok"],
      ["fetch", "Fetched", "ok"],
      ["summarize", "Completed", "ok"],
      ["sync", "Synced", "ok"],
    ],
  );
});

test("worker host panel shows blocked runtimes as online runtime blockers with retry timing", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  assert.match(log, /workerHost\.runtimeHealthState === "blocked"/);
  assert.match(log, /Runtime blocked/);
  assert.match(log, /waiting_for_runtime/);
  assert.match(log, /workerHost\.runtimeRetryAt/);
  assert.match(log, /Next retry <RelativeTime value=\{workerHost\.runtimeRetryAt\}/);
  assert.match(log, /workerHost\.status === "offline"/);
});

test("cloud source detail reuses source-level budget and deadline facts without exposing internal budget reason copy", () => {
  const sourceLogItem = source("src/components/CloudSourceLogItem.tsx");

  assert.match(sourceLogItem, /Initial budget/);
  assert.match(sourceLogItem, /Deadline risk/);
  assert.match(sourceLogItem, /Must succeed by/);
  assert.doesNotMatch(sourceLogItem, /Budget reason/);
});

test("cloud worker host uses a distinct jobType so it never leaks into a personal fetch log", () => {
  // Server accepts the cloud jobType.
  const jobRunsRoute = source("src/app/api/skill/job-runs/route.ts");
  assert.match(jobRunsRoute, /jobType: z\.enum\(\["library-fetch", "cloud-library-fetch", "digest-build"\]\)/);

  // The cloud management page and admin log endpoint read cloud-library-fetch
  // worker host progress...
  const cloudPage = source("src/app/(workspace)/settings/cloud-library/page.tsx");
  assert.match(cloudPage, /getAgentJobRuns\(userId, "cloud-library-fetch", 5\)/);
  assert.match(cloudPage, /serializeCloudWorkerHost/);
  assert.match(cloudPage, /initialWorkerHost/);
  const cloudRunsRoute = source("src/app/api/admin/cloud-fetch/runs/route.ts");
  assert.match(cloudRunsRoute, /getAgentJobRuns\(userId, "cloud-library-fetch", 5\)/);

  // ...while the personal fetch log stays on library-fetch (excludes cloud rounds).
  const personalFetchRuns = source("src/app/api/skill/fetch-runs/route.ts");
  assert.match(personalFetchRuns, /loadFetchRunHistoryAgentJobs\(/);
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  assert.match(buildersPage, /loadFetchRunHistoryAgentJobs\(/);
  const agentJobRuns = source("src/lib/agent-job-runs.ts");
  assert.match(agentJobRuns, /jobType: "library-fetch"/);
  assert.match(
    agentJobRuns,
    /scheduleJob: "library-cron",\s*trigger: "scheduled"/,
  );
});

test("runner and CLI tag cloud rounds with the cloud-library-fetch jobType", () => {
  // Runner: job_type_for_name maps cloud-library-* to the cloud jobType.
  const runner = source("scripts/builder-agent-runner.sh");
  assert.match(runner, /cloud-library-\*\) printf '%s\\n' "cloud-library-fetch"/);

  // CLI live-progress emitter derives the jobType from BUILDER_BLOG_RUN_SOURCE=cloud
  // instead of hardcoding "library-fetch".
  const cli = source("scripts/builder-digest.mjs");
  assert.match(cli, /BUILDER_BLOG_RUN_SOURCE\?\.trim\(\) === "cloud"\s*\n?\s*\? "cloud-library-fetch"/);
  assert.match(cli, /jobType: envJobType\(\)/);
});

test("admin cloud source drill-down route is admin-gated and returns submitters", () => {
  const route = source("src/app/api/admin/cloud-fetch/sources/[builderId]/route.ts");

  assert.match(route, /export async function GET/);
  assert.match(route, /requireCloudFetchAdmin\(request\)/);
  assert.match(route, /cloudSourceSubmission\.findMany/);
  assert.match(route, /serializeCloudSourceSubmitter/);
});

test("cloud library explorer lists libraries and renders recent posts via BuilderFeedItems", () => {
  const explorer = source("src/components/AdminCloudLibraryExplorer.tsx");

  assert.match(explorer, /postCount/);
  assert.match(explorer, /submitterCount/);
  assert.match(explorer, /statusChipLabel/);
  assert.match(explorer, /CloudSourceLogItem/);
  assert.match(explorer, /showSubmitters=\{true\}/);
  assert.match(explorer, /\/api\/admin\/cloud-fetch\/sources\/\$\{builderId\}/);
  assert.match(explorer, /submitters: detail\?\.submitters/);
  assert.match(explorer, /useEffect\(\(\) => \{[\s\S]*const builderId = expanded[\s\S]*\/api\/admin\/cloud-fetch\/sources\/\$\{builderId\}[\s\S]*\}, \[expanded, libraries\]\)/);
  assert.doesNotMatch(explorer, /BuilderFeedItems/);
  assert.doesNotMatch(explorer, /showSubmitters=\{false\}/);
  assert.doesNotMatch(explorer, /className="cloud-source-head"/);
});

test("cloud library overview has a focused admin endpoint shared with the server page", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");
  const route = source("src/app/api/admin/cloud-fetch/libraries/route.ts");
  const data = source("src/lib/cloud-library-overview-data.ts");

  assert.match(page, /getCloudLibraryAdminSnapshot/);
  assert.match(route, /requireCloudFetchAdmin\(request\)/);
  assert.match(route, /getCloudLibraryAdminSnapshot/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(data, /cloudLanguageLibrary\.findMany/);
  assert.match(data, /cloudSourceSubmission\.groupBy/);
  assert.match(data, /feedItem\.groupBy/);
});

test("cloud library status refreshes while visible without refreshing editable config", () => {
  const provider = source("src/components/AdminCloudLibraryLiveProvider.tsx");
  const config = source("src/components/AdminCloudFetchConfigForm.tsx");

  assert.match(provider, /useEffect/);
  assert.match(provider, /\/api\/admin\/cloud-fetch\/libraries/);
  assert.match(provider, /cache: "no-store"/);
  assert.match(provider, /hasRunningSourceTask \? LIVE_POLL_RUNNING_MS : LIVE_POLL_IDLE_MS/);
  assert.match(provider, /document\.visibilityState === "visible"/);
  assert.match(provider, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(provider, /contentSyncStateChanged/);
  assert.match(provider, /requestWorkspaceRefresh/);
  assert.match(config, /useCloudLibraryLiveSnapshot/);
  assert.match(config, /updateLanguageLibrary\(next\)/);
  assert.doesNotMatch(config, /setInterval/);
  assert.doesNotMatch(config, /\/api\/admin\/cloud-fetch\/libraries/);
});

test("cloud source log item is shared by admin and user cloud source lists", () => {
  const shared = source("src/components/CloudSourceLogItem.tsx");
  const explorer = source("src/components/AdminCloudLibraryExplorer.tsx");
  const userTabs = source("src/components/SourceSyncLogTabs.tsx");

  assert.match(shared, /export function CloudSourceLogItem/);
  assert.match(shared, /showSubmitters/);
  assert.match(shared, /Latest cloud fetch log/);
  assert.match(shared, /Recent posts/);
  assert.match(shared, /BuilderFeedItems/);
  assert.match(explorer, /<CloudSourceLogItem/);
  assert.match(explorer, /showSubmitters=\{true\}/);
  assert.match(userTabs, /<CloudSourceLogItem/);
  assert.match(userTabs, /showSubmitters=\{false\}/);
});

test("cloud-library page mounts the library explorer with serialized libraries", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");
  const panel = source("src/components/AdminCloudLibrariesPanel.tsx");
  const data = source("src/lib/cloud-library-overview-data.ts");

  assert.match(page, /AdminCloudLibraryLiveProvider/);
  assert.match(page, /AdminCloudLibrariesPanel/);
  assert.match(panel, /AdminCloudLibraryExplorer/);
  assert.match(panel, /CountMeta/);
  assert.match(data, /serializeCloudLibrary/);
  assert.match(data, /activeSourceTasks/);
  assert.match(data, /submitterCountByBuilder\.get\(task\.builderId\) \?\? 0/);
});
