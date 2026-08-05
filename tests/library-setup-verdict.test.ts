import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

type JsonRecord = Record<string, unknown>;

async function verdictModule() {
  return import("../scripts/builder-digest.mjs") as Promise<{
    classifyLibrarySetupVerdictForTest?: (input: JsonRecord) => JsonRecord;
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

test("keeps candidate discovery and runtime authentication failures fatal", async () => {
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

  assert.equal(discoveryVerdict.status, "fatal");
  assert.equal(authVerdict.status, "fatal");
});

test("accepts only well-formed durably synchronized user actions", async () => {
  const cli = await verdictModule();
  const action = userActionTask("x-token");
  const ok = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 0,
    tasks: [action],
    syncPayload: {
      builders: [],
      taskOutcomes: [{ fetchTaskId: "x-token", status: "action_needed", reason: "x_token_missing" }],
    },
  }));
  const malformed = cli.classifyLibrarySetupVerdictForTest!(classificationInput({
    runnerExitCode: 65,
    tasks: [action],
    syncPayload: {
      builders: [],
      taskOutcomes: [{ fetchTaskId: "x-token", status: "failed", reason: "x_token_missing" }],
    },
  }));

  assert.equal(ok.status, "ok");
  assert.equal(ok.plannedTaskCount, 0);
  assert.equal(ok.synchronizedTerminalTaskCount, 1);
  assert.equal(malformed.status, "fatal");
});

test("allows the true zero-non-discovery-task path only on exit 0", async () => {
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

  assert.equal(ok.status, "ok");
  assert.equal(failed.status, "fatal");
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
