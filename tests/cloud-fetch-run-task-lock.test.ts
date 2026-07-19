import assert from "node:assert/strict";
import test from "node:test";

import { lockCloudFetchRunTaskRows } from "../src/lib/cloud-fetch-run-task-lock";

test("cloud fetch run task lock uses parameterized FOR UPDATE query and returns locked rows", async () => {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const rows = await lockCloudFetchRunTaskRows(
    {
      async $queryRawUnsafe(query: string, ...values: unknown[]) {
        calls.push({ query, values });
        return [
          { cloudSourceTaskId: "task_a", status: "RUNNING", details: { executionPlan: {} } },
          { cloudSourceTaskId: "task_b", status: "RUNNING", details: {} },
        ];
      },
    },
    { runId: "run_1", cloudSourceTaskIds: ["task_a", "task_b"] },
  );

  assert.deepEqual(rows.map((row) => row.cloudSourceTaskId), ["task_a", "task_b"]);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.query, /SELECT[\s\S]*FROM "CloudFetchRunTask"/);
  assert.match(calls[0]!.query, /"runId" = \$1/);
  assert.match(calls[0]!.query, /"cloudSourceTaskId" IN \(\$2, \$3\)/);
  assert.match(calls[0]!.query, /FOR UPDATE/);
  assert.deepEqual(calls[0]!.values, ["run_1", "task_a", "task_b"]);
});

test("cloud fetch run task lock skips querying when no task ids are requested", async () => {
  let queryCount = 0;
  const rows = await lockCloudFetchRunTaskRows(
    {
      async $queryRawUnsafe() {
        queryCount += 1;
        return [];
      },
    },
    { runId: "run_1", cloudSourceTaskIds: [] },
  );

  assert.deepEqual(rows, []);
  assert.equal(queryCount, 0);
});
