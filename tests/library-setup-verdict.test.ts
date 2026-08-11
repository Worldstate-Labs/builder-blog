import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

type JsonRecord = Record<string, unknown>;
type SetupVerdict = JsonRecord & {
  status: string;
  failures: Array<Record<string, unknown>>;
};

async function verdictModule() {
  return import("../scripts/builder-digest.mjs") as Promise<{
    classifyLibrarySetupVerdictForTest?: (input: JsonRecord) => SetupVerdict;
  }>;
}

function postTask(id: string, overrides: JsonRecord = {}) {
  return {
    id,
    builder: `Source ${id}`,
    sourceType: "blog",
    title: `Post ${id}`,
    url: `https://example.com/${id}`,
    agentWorkType: "fetch_post",
    ...overrides,
  };
}

function userActionTask(id: string, kind = "x_token_missing") {
  return {
    id,
    builder: "Example on X",
    sourceType: "x",
    title: "Add an X bearer token",
    agentWorkType: kind,
  };
}

function discoveryTask(id: string) {
  return {
    id,
    builder: "Product Hunt",
    sourceType: "product_hunt",
    agentWorkType: "candidate_discovery_fallback",
    type: "candidate_discovery",
  };
}

function syncedItem(taskId: string) {
  return {
    builders: [
      {
        sourceType: "blog",
        items: [
          {
            title: `Post ${taskId}`,
            url: `https://example.com/${taskId}`,
            rawJson: { fetchTaskId: taskId },
          },
        ],
      },
    ],
    taskOutcomes: [],
  };
}

function classificationInput({
  runnerExitCode,
  tasks,
  syncPayload,
  syncedTaskIds,
  taskOutcomes = [],
  failurePayloads = [],
}: {
  runnerExitCode: number;
  tasks: JsonRecord[];
  syncPayload?: JsonRecord;
  syncedTaskIds?: string[];
  taskOutcomes?: JsonRecord[];
  failurePayloads?: JsonRecord[];
}) {
  const fetchResult = { fetchTasks: tasks, taskOutcomes };
  return {
    runnerExitCode,
    instanceId: randomUUID(),
    fetchResult,
    mergedFetchResult: fetchResult,
    syncPayload: syncPayload ?? { builders: [], taskOutcomes: [] },
    syncedTaskIds: syncedTaskIds ?? tasks.map((task) => String(task.id)),
    mergeResult: { status: "ok", taskIds: tasks.map((task) => String(task.id)), shards: [] },
    remainingMergeResult: { status: "ok", taskIds: [], shards: [] },
    failurePayloads,
  };
}

test("classifies a clean synchronized setup proof as ok", async () => {
  const cli = await verdictModule();
  assert.equal(typeof cli.classifyLibrarySetupVerdictForTest, "function");
  const task = postTask("post-ok");

  const verdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 0,
    tasks: [task],
    syncPayload: syncedItem("post-ok"),
  }));

  assert.equal(verdict.status, "ok");
  assert.equal(verdict.runnerExitCode, 0);
  assert.equal(verdict.plannedTaskCount, 1);
  assert.equal(verdict.synchronizedTerminalTaskCount, 1);
  assert.deepEqual(verdict.failures, []);
});

test("classifies a durably synchronized headline failure after exit 65 as needs_confirmation", async () => {
  const cli = await verdictModule();
  const tasks = [postTask("post-ok"), postTask("post-headline")];
  const verdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 65,
    tasks,
    syncPayload: syncedItem("post-ok"),
    failurePayloads: [
      {
        builders: [],
        taskOutcomes: [
          {
            fetchTaskId: "post-headline",
            status: "failed",
            reason: "task_validation_failed",
            completedStage: "summarize",
            evidence: {
              failureKind: "task_validation_failed",
              validation: { errors: ["headline:headline_too_long"] },
            },
          },
        ],
      },
    ],
  }));

  assert.equal(verdict.status, "needs_confirmation");
  assert.deepEqual(verdict.failures, [
    {
      fetchTaskId: "post-headline",
      title: "Post post-headline",
      source: "Source post-headline · blog",
      stage: "summarize",
      reason: "headline:headline_too_long",
    },
  ]);
});

test("classifies a runner-managed media failure retained as a planned outcome as needs_confirmation", async () => {
  const cli = await verdictModule();
  const mediaTask = postTask("youtube-media", {
    sourceType: "youtube",
    agentWorkType: "youtube_transcription",
    plannedExtractionMethod: "audio_transcription",
  });
  const mediaOutcome = {
    fetchTaskId: "youtube-media",
    status: "failed",
    reason: "audio_download:javascript_runtime_unavailable",
    plannedTask: mediaTask,
  };
  const verdict = cli.classifyLibrarySetupVerdictForTest!({
    runnerExitCode: 65,
    instanceId: randomUUID(),
    fetchResult: { fetchTasks: [], taskOutcomes: [mediaOutcome] },
    mergedFetchResult: { fetchTasks: [], taskOutcomes: [mediaOutcome] },
    syncPayload: { builders: [], taskOutcomes: [mediaOutcome] },
    syncedTaskIds: ["youtube-media"],
    mergeResult: { status: "ok", taskIds: ["youtube-media"], shards: [] },
    remainingMergeResult: { status: "ok", taskIds: [], shards: [] },
    failurePayloads: [],
  });

  assert.equal(verdict.status, "needs_confirmation");
  assert.equal(verdict.plannedTaskCount, 1);
  assert.equal(verdict.synchronizedTerminalTaskCount, 1);
  assert.deepEqual(verdict.failures, [{
    fetchTaskId: "youtube-media",
    title: "Post youtube-media",
    source: "Source youtube-media · youtube",
    stage: "read",
    reason: "audio_download:javascript_runtime_unavailable",
  }]);
});

test("keeps exit 65 fatal when a failed post is not in the durable ledger", async () => {
  const cli = await verdictModule();
  const task = postTask("post-unsynced");
  const verdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 65,
    tasks: [task],
    syncedTaskIds: [],
    syncPayload: {
      builders: [],
      taskOutcomes: [{ fetchTaskId: "post-unsynced", status: "failed", reason: "worker_missing_result" }],
    },
  }));

  assert.equal(verdict.status, "fatal");
});

test("allows a missing shard only after its synthesized terminal failure was accepted", async () => {
  const cli = await verdictModule();
  const task = postTask("post-missing-result");
  const verdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 65,
    tasks: [task],
    syncPayload: {
      builders: [],
      taskOutcomes: [{
        fetchTaskId: "post-missing-result",
        status: "failed",
        reason: "worker_missing_result",
        evidence: { failureKind: "missing_worker_result_file" },
      }],
    },
  }));

  assert.equal(verdict.status, "needs_confirmation");
});

test("requires confirmation for source discovery failures while keeping runtime authentication fatal", async () => {
  const cli = await verdictModule();
  const post = postTask("post-auth");
  const discovery = discoveryTask("candidate_discovery:ph");
  const discoveryVerdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 65,
    tasks: [post],
    syncPayload: syncedItem("post-auth"),
    taskOutcomes: [{
      fetchTaskId: discovery.id,
      status: "failed",
      reason: "candidate_discovery_failed",
      evidence: { blocker: "Provider rejected the discovery request" },
      plannedTask: discovery,
    }],
  }));
  const authVerdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 65,
    tasks: [post],
    syncPayload: {
      builders: [],
      taskOutcomes: [{
        fetchTaskId: "post-auth",
        status: "failed",
        reason: "runtime_auth_failed",
        evidence: { failureKind: "runtime_auth_failed" },
      }],
    },
  }));

  assert.equal(discoveryVerdict.status, "needs_confirmation");
  assert.deepEqual(discoveryVerdict.failures, [{
    fetchTaskId: discovery.id,
    title: "Product Hunt discovery",
    source: "Product Hunt · product_hunt",
    stage: "read",
    reason: "candidate_discovery_failed",
  }]);
  assert.equal(authVerdict.status, "fatal");
});

test("keeps legacy runner exit 0 fatal when discovery failed", async () => {
  const cli = await verdictModule();
  const post = postTask("post-synced");
  const discovery = discoveryTask("candidate_discovery:product_hunt");
  const verdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 0,
    tasks: [post],
    syncPayload: syncedItem(post.id),
    taskOutcomes: [{
      fetchTaskId: discovery.id,
      status: "blocked",
      reason: "product_hunt_discovery_blocked",
      evidence: { blocker: "HTTP 403" },
      plannedTask: discovery,
    }],
  }));

  assert.equal(verdict.status, "fatal");
  assert.equal(verdict.runnerExitCode, 0);
  assert.equal(verdict.plannedTaskCount, 1);
  assert.equal(verdict.synchronizedTerminalTaskCount, 1);
  assert.deepEqual(verdict.failures, [{
    fetchTaskId: discovery.id,
    title: "Product Hunt discovery",
    source: "Product Hunt · product_hunt",
    stage: "read",
    reason: "product_hunt_discovery_blocked",
  }]);
});

test("keeps missing discovery evidence and internal normalization failures fatal", async () => {
  const cli = await verdictModule();
  const post = postTask("post-synced");
  const discovery = discoveryTask("candidate_discovery:product_hunt");
  const missingEvidence = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 65,
    tasks: [post],
    syncPayload: syncedItem(post.id),
    taskOutcomes: [{
      fetchTaskId: discovery.id,
      status: "blocked",
      reason: "product_hunt_discovery_blocked",
      plannedTask: discovery,
    }],
  }));
  const missingResult = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 65,
    tasks: [post],
    syncPayload: syncedItem(post.id),
    taskOutcomes: [{
      fetchTaskId: discovery.id,
      status: "failed",
      reason: "candidate_discovery_result_missing",
      evidence: { failureKind: "candidate_discovery_result_missing" },
      plannedTask: discovery,
    }],
  }));

  assert.equal(missingEvidence.status, "fatal");
  assert.equal(missingResult.status, "fatal");
  assert.equal(missingEvidence.failures[0]?.reason, "product_hunt_discovery_blocked");
  assert.equal(missingResult.failures[0]?.reason, "candidate_discovery_result_missing");
});

test("keeps conflicting or unexpected discovery outcomes fatal", async () => {
  const cli = await verdictModule();
  const post = postTask("post-synced");
  const discovery = discoveryTask("candidate_discovery:product_hunt");
  const base = classificationInput({
    runnerExitCode: 65,
    tasks: [post],
    syncPayload: {
      ...syncedItem(post.id),
      taskOutcomes: [{
        fetchTaskId: discovery.id,
        status: "blocked",
        reason: "product_hunt_discovery_blocked",
        evidence: { blocker: "HTTP 403" },
      }],
    },
    taskOutcomes: [{
      fetchTaskId: discovery.id,
      status: "failed",
      reason: "candidate_discovery_failed",
      evidence: { blocker: "Provider error" },
      plannedTask: discovery,
    }],
  });
  const conflicting = cli.classifyLibrarySetupVerdictForTest!(base);
  const unexpected = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 0,
    tasks: [post],
    syncPayload: syncedItem(post.id),
    taskOutcomes: [{
      fetchTaskId: discovery.id,
      status: "synced",
      reason: "unexpected_discovery_success_outcome",
      evidence: { candidates: 3 },
      plannedTask: discovery,
    }],
  }));

  assert.equal(conflicting.status, "fatal");
  assert.equal(unexpected.status, "fatal");
});

test("does not trust a discovery id prefix when task metadata declares a post", async () => {
  const cli = await verdictModule();
  const task = postTask("candidate_discovery:not-a-discovery", { type: "fetch_post" });
  const verdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 65,
    tasks: [task],
    syncPayload: {
      builders: [],
      taskOutcomes: [{
        fetchTaskId: task.id,
        status: "blocked",
        reason: "post_fetch_blocked",
        evidence: { blocker: "HTTP 403" },
        plannedTask: task,
      }],
    },
  }));

  assert.equal(verdict.status, "fatal");
});

test("keeps post failures fatal when the runner incorrectly exits 0", async () => {
  const cli = await verdictModule();
  const post = postTask("post-failed-with-zero-exit");
  const verdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 0,
    tasks: [post],
    syncPayload: {
      builders: [],
      taskOutcomes: [{
        fetchTaskId: post.id,
        status: "failed",
        reason: "task_validation_failed",
      }],
    },
  }));

  assert.equal(verdict.status, "fatal");
});

test("preserves discovery task identity when a later sync outcome omits plannedTask", async () => {
  const cli = await verdictModule();
  const post = postTask("post-synced");
  const discovery = discoveryTask("candidate_discovery:product_hunt");
  const verdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 65,
    tasks: [post],
    syncPayload: {
      ...syncedItem(post.id),
      taskOutcomes: [{
        fetchTaskId: discovery.id,
        status: "blocked",
        reason: "product_hunt_discovery_blocked",
      }],
    },
    taskOutcomes: [{
      fetchTaskId: discovery.id,
      status: "blocked",
      reason: "product_hunt_discovery_blocked",
      evidence: { blocker: "HTTP 403" },
      plannedTask: discovery,
    }],
  }));

  assert.equal(verdict.status, "needs_confirmation");
  assert.equal(verdict.failures.length, 1);
  assert.equal(verdict.failures[0]?.title, "Product Hunt discovery");
});

test("does not treat user actions as scheduler fetch work", async () => {
  const cli = await verdictModule();
  const action = userActionTask("x-token");
  const verdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 0,
    tasks: [action],
    syncedTaskIds: [],
    syncPayload: {
      builders: [],
      taskOutcomes: [{ fetchTaskId: "x-token", status: "action_needed", reason: "x_token_missing" }],
    },
  }));

  assert.equal(verdict.status, "ok");
  assert.equal(verdict.plannedTaskCount, 0);
  assert.equal(verdict.synchronizedTerminalTaskCount, 0);
});

test("asks for confirmation when partial post failures coexist with a synced user action", async () => {
  const cli = await verdictModule();
  const failedPosts = [postTask("post-1"), postTask("post-2"), postTask("post-3")];
  const action = userActionTask("x-token", "x_token_invalid");
  const taskOutcomes = failedPosts.map((task) => ({
    fetchTaskId: task.id,
    status: "failed",
    reason: "primary_content_unavailable",
  }));
  taskOutcomes.push({
    fetchTaskId: action.id,
    status: "action_needed",
    reason: "x_token_invalid",
  });

  const verdict = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 65,
    tasks: [...failedPosts, action],
    syncedTaskIds: failedPosts.map((task) => task.id),
    syncPayload: { builders: [], taskOutcomes },
  }));

  assert.equal(verdict.status, "needs_confirmation");
  assert.equal(verdict.plannedTaskCount, 3);
  assert.equal(verdict.synchronizedTerminalTaskCount, 3);
  assert.equal(verdict.failures.length, 3);
});

test("allows the true zero-post-task path only on exit 0", async () => {
  const cli = await verdictModule();
  const ok = cli.classifyLibrarySetupVerdictForTest!({
    runnerExitCode: 0,
    instanceId: randomUUID(),
    fetchResult: { fetchTasks: [], taskOutcomes: [] },
  });
  const failed = cli.classifyLibrarySetupVerdictForTest!({
    runnerExitCode: 65,
    instanceId: randomUUID(),
    fetchResult: { fetchTasks: [], taskOutcomes: [] },
  });
  const failedSourceOutcome = cli.classifyLibrarySetupVerdictForTest!({
    runnerExitCode: 0,
    instanceId: randomUUID(),
    fetchResult: {
      fetchTasks: [],
      taskOutcomes: [{
        fetchTaskId: "source-post-failed",
        status: "failed",
        reason: "source_sync_failed",
        plannedTask: postTask("source-post-failed"),
      }],
    },
  });
  const malformedSourceOutcome = cli.classifyLibrarySetupVerdictForTest!({
    runnerExitCode: 0,
    instanceId: randomUUID(),
    fetchResult: {
      fetchTasks: [],
      taskOutcomes: [{ fetchTaskId: "source-without-plan", status: "skipped", reason: "no_update" }],
    },
  });
  const safelySkippedSourceOutcome = cli.classifyLibrarySetupVerdictForTest!({
    runnerExitCode: 0,
    instanceId: randomUUID(),
    fetchResult: {
      fetchTasks: [],
      taskOutcomes: [{
        fetchTaskId: "source-post-skipped",
        status: "skipped",
        reason: "already_fetched",
        evidence: { checkedAt: "2026-08-05T00:00:00.000Z" },
        plannedTask: postTask("source-post-skipped"),
      }],
    },
  });
  const discovery = discoveryTask("candidate_discovery:product_hunt");
  const discoveryOnlyPartial = cli.classifyLibrarySetupVerdictForTest!({
    runnerExitCode: 65,
    instanceId: randomUUID(),
    fetchResult: {
      fetchTasks: [],
      taskOutcomes: [{
        fetchTaskId: discovery.id,
        status: "blocked",
        reason: "product_hunt_discovery_blocked",
        evidence: { blocker: "HTTP 403" },
        plannedTask: discovery,
      }],
    },
  });
  const tooManyDiscoveryFailures = cli.classifyLibrarySetupVerdictForTest!({
    runnerExitCode: 65,
    instanceId: randomUUID(),
    fetchResult: {
      fetchTasks: [],
      taskOutcomes: Array.from({ length: 201 }, (_, index) => {
        const task = discoveryTask(`candidate_discovery:source-${index}`);
        return {
          fetchTaskId: task.id,
          status: "blocked",
          reason: "candidate_discovery_blocked",
          evidence: { blocker: "Provider unavailable" },
          plannedTask: task,
        };
      }),
    },
  });

  assert.equal(ok.status, "ok");
  assert.equal(failed.status, "fatal");
  assert.equal(failedSourceOutcome.status, "fatal");
  assert.equal(malformedSourceOutcome.status, "fatal");
  assert.equal(safelySkippedSourceOutcome.status, "ok");
  assert.equal(discoveryOnlyPartial.status, "needs_confirmation");
  assert.equal(discoveryOnlyPartial.failures.length, 1);
  assert.equal(tooManyDiscoveryFailures.status, "fatal");
});

test("treats skipped posts as terminal non-failures and overall timeouts as fatal", async () => {
  const cli = await verdictModule();
  const task = postTask("post-skipped");
  const skipped = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 0,
    tasks: [task],
    syncPayload: {
      builders: [],
      taskOutcomes: [{ fetchTaskId: "post-skipped", status: "skipped", reason: "already_fetched" }],
    },
  }));
  const timedOut = cli.classifyLibrarySetupVerdictForTest!({
    runnerExitCode: 124,
    instanceId: randomUUID(),
    fetchResult: { fetchTasks: [], taskOutcomes: [] },
  });

  assert.equal(skipped.status, "ok");
  assert.equal(timedOut.status, "fatal");
});

test("rejects missing fetchTasks arrays and mismatched merged plans", async () => {
  const cli = await verdictModule();
  const malformedInitial = cli.classifyLibrarySetupVerdictForTest!({
    runnerExitCode: 0,
    instanceId: randomUUID(),
    fetchResult: {},
  });
  const task = postTask("post-plan");
  const mismatchedMerged = cli.classifyLibrarySetupVerdictForTest!({
    ...classificationInput({
      runnerExitCode: 0,
      tasks: [task],
      syncPayload: syncedItem("post-plan"),
    }),
    mergedFetchResult: { fetchTasks: [], taskOutcomes: [] },
  });

  assert.equal(malformedInitial.status, "fatal");
  assert.equal(mismatchedMerged.status, "fatal");
});

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function makeRunArtifacts() {
  const root = await mkdtemp(join(tmpdir(), "followbrief-setup-verdict-"));
  const stateDir = join(root, "library-cron-direct");
  const instanceId = randomUUID();
  const runDir = join(stateDir, "runs", instanceId);
  const accountSlug = "user_example_com_deadbeef";
  const task = postTask("post-cli");
  await mkdir(runDir, { recursive: true });
  await writeJson(join(runDir, ".run-owner.json"), {
    app: "followbrief",
    accountSlug,
    jobName: "library-cron",
    instanceId,
  });
  await writeJson(join(runDir, "library-fetch-result.json"), { fetchTasks: [task], taskOutcomes: [] });
  await writeJson(join(runDir, "library-fetch-merged.json"), { fetchTasks: [task], taskOutcomes: [] });
  await writeJson(join(runDir, "library-agent-sync.json"), syncedItem("post-cli"));
  await writeJson(join(runDir, "merge-task-results.json"), { status: "ok", taskIds: ["post-cli"], shards: [] });
  await writeJson(join(runDir, "merge-task-results-remaining.json"), { status: "ok", taskIds: ["post-cli"], shards: [] });
  await writeFile(join(runDir, "completed-checkpoint-synced-task-ids.txt"), "post-cli\n", { mode: 0o600 });
  return {
    root,
    stateDir,
    runDir,
    instanceId,
    accountSlug,
    verdictFile: join(stateDir, `setup-verdict-${instanceId}.json`),
  };
}

function runVerdictCli(args: string[]) {
  return spawnSync(process.execPath, ["scripts/builder-digest.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

test("CLI writes and verifies one atomic mode-0600 verdict for the current run", async () => {
  const fixture = await makeRunArtifacts();
  try {
    const classified = runVerdictCli([
      "classify-library-setup-verdict",
      "--job-state-dir", fixture.stateDir,
      "--run-dir", fixture.runDir,
      "--out", fixture.verdictFile,
      "--runner-exit-code", "0",
      "--instance-id", fixture.instanceId,
      "--account-slug", fixture.accountSlug,
      "--job-name", "library-cron",
    ]);
    assert.equal(classified.status, 0, classified.stderr);
    assert.equal((await stat(fixture.verdictFile)).mode & 0o777, 0o600);
    assert.equal((await lstat(fixture.verdictFile)).isSymbolicLink(), false);

    const verified = runVerdictCli([
      "verify-library-setup-verdict",
      "--file", fixture.verdictFile,
      "--instance-id", fixture.instanceId,
      "--runner-exit-code", "0",
    ]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).status, "ok");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("CLI rejects stale instances, unsafe output paths, symlinks, and missing evidence", async () => {
  const fixture = await makeRunArtifacts();
  try {
    const outside = resolve(fixture.root, "outside.json");
    const unsafeOutput = runVerdictCli([
      "classify-library-setup-verdict",
      "--job-state-dir", fixture.stateDir,
      "--run-dir", fixture.runDir,
      "--out", outside,
      "--runner-exit-code", "0",
      "--instance-id", fixture.instanceId,
      "--account-slug", fixture.accountSlug,
      "--job-name", "library-cron",
    ]);
    assert.notEqual(unsafeOutput.status, 0);

    await rm(join(fixture.runDir, "merge-task-results-remaining.json"));
    const missingEvidence = runVerdictCli([
      "classify-library-setup-verdict",
      "--job-state-dir", fixture.stateDir,
      "--run-dir", fixture.runDir,
      "--out", fixture.verdictFile,
      "--runner-exit-code", "0",
      "--instance-id", fixture.instanceId,
      "--account-slug", fixture.accountSlug,
      "--job-name", "library-cron",
    ]);
    assert.equal(missingEvidence.status, 0, missingEvidence.stderr);
    assert.equal(JSON.parse(await readFile(fixture.verdictFile, "utf8")).status, "fatal");

    const stale = runVerdictCli([
      "verify-library-setup-verdict",
      "--file", fixture.verdictFile,
      "--instance-id", randomUUID(),
      "--runner-exit-code", "0",
    ]);
    assert.notEqual(stale.status, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("CLI classifies library-once partial runs print-only without writing a verdict file", async () => {
  const fixture = await makeRunArtifacts();
  try {
    const okTask = postTask("post-cli");
    const failedTask = postTask("post-fail");
    await writeJson(join(fixture.runDir, ".run-owner.json"), {
      app: "followbrief",
      accountSlug: fixture.accountSlug,
      jobName: "library-once",
      instanceId: fixture.instanceId,
    });
    await writeJson(join(fixture.runDir, "library-fetch-result.json"), { fetchTasks: [okTask, failedTask], taskOutcomes: [] });
    await writeJson(join(fixture.runDir, "library-fetch-merged.json"), { fetchTasks: [okTask, failedTask], taskOutcomes: [] });
    await writeJson(join(fixture.runDir, "merge-task-results.json"), { status: "ok", taskIds: ["post-cli", "post-fail"], shards: [] });
    await writeJson(join(fixture.runDir, "merge-task-results-remaining.json"), { status: "ok", taskIds: ["post-cli", "post-fail"], shards: [] });
    await writeFile(join(fixture.runDir, "completed-checkpoint-synced-task-ids.txt"), "post-cli\npost-fail\n", { mode: 0o600 });
    await writeJson(join(fixture.runDir, "library-result-slice-000-payload-validation-failed-payload.json"), {
      builders: [],
      taskOutcomes: [
        {
          fetchTaskId: "post-fail",
          status: "failed",
          reason: "task_validation_failed",
          evidence: {
            failureKind: "task_validation_failed",
            validation: { errors: ["headline:headline_too_long"] },
          },
        },
      ],
    });

    const classified = runVerdictCli([
      "classify-library-setup-verdict",
      "--job-state-dir", fixture.stateDir,
      "--run-dir", fixture.runDir,
      "--runner-exit-code", "65",
      "--instance-id", fixture.instanceId,
      "--account-slug", fixture.accountSlug,
      "--job-name", "library-once",
    ]);
    assert.equal(classified.status, 0, classified.stderr);
    const verdict = JSON.parse(classified.stdout);
    assert.equal(verdict.status, "needs_confirmation");
    assert.equal(verdict.failures.length, 1);
    assert.equal(verdict.failures[0].stage, "summarize");
    await assert.rejects(stat(fixture.verdictFile), /ENOENT/);

    const rejectedJob = runVerdictCli([
      "classify-library-setup-verdict",
      "--job-state-dir", fixture.stateDir,
      "--run-dir", fixture.runDir,
      "--runner-exit-code", "65",
      "--instance-id", fixture.instanceId,
      "--account-slug", fixture.accountSlug,
      "--job-name", "digest-cron",
    ]);
    assert.notEqual(rejectedJob.status, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("CLI setup with only a user-action notice needs no post-sync artifacts", async () => {
  const fixture = await makeRunArtifacts();
  try {
    await writeJson(join(fixture.runDir, "library-fetch-result.json"), {
      fetchTasks: [userActionTask("x-token", "x_token_invalid")],
      taskOutcomes: [{
        fetchTaskId: "x-token",
        status: "action_needed",
        reason: "x_token_invalid",
      }],
    });
    for (const name of [
      "library-fetch-merged.json",
      "library-agent-sync.json",
      "merge-task-results.json",
      "merge-task-results-remaining.json",
      "completed-checkpoint-synced-task-ids.txt",
    ]) {
      await rm(join(fixture.runDir, name), { force: true });
    }

    const classified = runVerdictCli([
      "classify-library-setup-verdict",
      "--job-state-dir", fixture.stateDir,
      "--run-dir", fixture.runDir,
      "--out", fixture.verdictFile,
      "--runner-exit-code", "0",
      "--instance-id", fixture.instanceId,
      "--account-slug", fixture.accountSlug,
      "--job-name", "library-cron",
    ]);

    assert.equal(classified.status, 0, classified.stderr);
    const verdict = JSON.parse(await readFile(fixture.verdictFile, "utf8"));
    assert.equal(verdict.status, "ok");
    assert.equal(verdict.plannedTaskCount, 0);
    assert.equal(verdict.synchronizedTerminalTaskCount, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("verifier rejects duplicate and unknown fields before JSON.parse can overwrite them", async () => {
  const root = await mkdtemp(join(tmpdir(), "followbrief-verdict-json-"));
  const instanceId = randomUUID();
  try {
    const duplicateTop = join(root, "duplicate-top.json");
    const duplicateNested = join(root, "duplicate-nested.json");
    const unknown = join(root, "unknown.json");
    const base = `"schemaVersion":1,"status":"ok","runnerExitCode":0,"instanceId":"${instanceId}","plannedTaskCount":0,"synchronizedTerminalTaskCount":0`;
    await writeFile(duplicateTop, `{${base},"status":"fatal","failures":[]}\n`);
    await writeFile(duplicateNested, `{${base},"failures":[{"fetchTaskId":"x","title":"x","source":"x","stage":"read","reason":"a","reason":"b"}]}\n`);
    await writeFile(unknown, `{${base},"unexpected":true,"failures":[]}\n`);

    for (const file of [duplicateTop, duplicateNested, unknown]) {
      const result = runVerdictCli([
        "verify-library-setup-verdict",
        "--file", file,
        "--instance-id", instanceId,
        "--runner-exit-code", "0",
      ]);
      assert.notEqual(result.status, 0, `${file} should fail verification`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects a discovery-only confirmation verdict after runner exit 0", async () => {
  const root = await mkdtemp(join(tmpdir(), "followbrief-verdict-discovery-partial-"));
  const instanceId = randomUUID();
  const file = join(root, "verdict.json");
  try {
    await writeJson(file, {
      schemaVersion: 1,
      status: "needs_confirmation",
      runnerExitCode: 0,
      instanceId,
      plannedTaskCount: 32,
      synchronizedTerminalTaskCount: 32,
      failures: [{
        fetchTaskId: "candidate_discovery:product_hunt",
        title: "Product Hunt discovery",
        source: "Product Hunt · product_hunt",
        stage: "read",
        reason: "product_hunt_discovery_blocked",
      }],
    });

    const verified = runVerdictCli([
      "verify-library-setup-verdict",
      "--file", file,
      "--instance-id", instanceId,
      "--runner-exit-code", "0",
    ]);
    assert.notEqual(verified.status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects a post confirmation verdict after runner exit 0", async () => {
  const root = await mkdtemp(join(tmpdir(), "followbrief-verdict-post-zero-exit-"));
  const instanceId = randomUUID();
  const file = join(root, "verdict.json");
  try {
    await writeJson(file, {
      schemaVersion: 1,
      status: "needs_confirmation",
      runnerExitCode: 0,
      instanceId,
      plannedTaskCount: 1,
      synchronizedTerminalTaskCount: 1,
      failures: [{
        fetchTaskId: "post-failed-with-zero-exit",
        title: "Failed post",
        source: "Example · blog",
        stage: "summarize",
        reason: "task_validation_failed",
      }],
    });

    const verified = runVerdictCli([
      "verify-library-setup-verdict",
      "--file", file,
      "--instance-id", instanceId,
      "--runner-exit-code", "0",
    ]);
    assert.notEqual(verified.status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
