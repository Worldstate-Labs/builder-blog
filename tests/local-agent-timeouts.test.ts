import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudDeadlineState,
  cloudShardExecutionBudget,
  localAgentShardTimeoutSeconds,
  localAgentTimeoutSeconds,
} from "../src/lib/local-agent-timeouts";

test("local agent timeout policy is shared and clamps expected cron windows", () => {
  assert.equal(localAgentTimeoutSeconds(60, "library-once"), "43200");
  assert.equal(localAgentTimeoutSeconds(60, "digest-once"), "43200");
  assert.equal(localAgentTimeoutSeconds(30, "library-cron"), "1440");
  assert.equal(localAgentTimeoutSeconds(60, "library-cron"), "2880");
  assert.equal(localAgentTimeoutSeconds(180, "library-cron"), "7200");
  assert.equal(localAgentTimeoutSeconds(1440, "cloud-library-host"), "7200");
  assert.equal(localAgentTimeoutSeconds(1440, "cloud-library-cron"), "7200");
  assert.equal(localAgentTimeoutSeconds(1440, "digest-cron"), "2700");
  assert.equal(localAgentTimeoutSeconds(0, "library-cron"), "2880");
  assert.equal(localAgentShardTimeoutSeconds(localAgentTimeoutSeconds(1440, "cloud-library-host")), "5400");
});

test("cloud shard execution budget enforces the 60 minute minimum for short estimates", () => {
  assert.equal(
    cloudShardExecutionBudget({ estimatedWorkSeconds: 10 * 60, sourceType: "blog" }).executionBudgetSeconds,
    60 * 60,
  );
  assert.equal(
    cloudShardExecutionBudget({ estimatedWorkSeconds: 30 * 60, sourceType: "blog" }).executionBudgetSeconds,
    60 * 60,
  );
});

test("cloud shard execution budget scales, adds allowance, and rounds to 5 minute increments", () => {
  const budget = cloudShardExecutionBudget({ estimatedWorkSeconds: 70 * 60, sourceType: "blog" });

  assert.equal(budget.estimatedWorkSeconds, 70 * 60);
  assert.equal(budget.executionBudgetSeconds, 115 * 60);
  assert.equal(budget.workloadClass, "standard");
});

test("cloud shard execution budget caps standard workloads at 2 hours", () => {
  const budget = cloudShardExecutionBudget({ estimatedWorkSeconds: 8_000, sourceType: "blog" });

  assert.equal(budget.executionBudgetSeconds, 2 * 60 * 60);
  assert.equal(budget.workloadClass, "standard");
});

test("cloud shard execution budget caps long-media workloads at 4 hours", () => {
  const budget = cloudShardExecutionBudget({ estimatedWorkSeconds: 20_000, sourceType: "podcast" });

  assert.equal(budget.executionBudgetSeconds, 4 * 60 * 60);
  assert.equal(budget.workloadClass, "long_media");
});

test("cloud shard execution budget normalizes invalid estimates to deterministic integer seconds", () => {
  const budget = cloudShardExecutionBudget({ estimatedWorkSeconds: "bad", sourceType: "blog" });

  assert.equal(budget.estimatedWorkSeconds, 0);
  assert.equal(budget.executionBudgetSeconds, 60 * 60);
});

test("cloud deadline state changes state only, not the computed execution budget", () => {
  const budget = cloudShardExecutionBudget({ estimatedWorkSeconds: 70 * 60, sourceType: "blog" });
  const now = new Date("2026-07-19T12:00:00.000Z");

  assert.equal(
    cloudDeadlineState({
      now,
      mustSucceedBy: new Date("2026-07-19T15:00:00.000Z"),
      executionBudgetSeconds: budget.executionBudgetSeconds,
    }),
    "on_time",
  );
  assert.equal(
    cloudDeadlineState({
      now,
      mustSucceedBy: new Date("2026-07-19T13:30:00.000Z"),
      executionBudgetSeconds: budget.executionBudgetSeconds,
    }),
    "at_risk",
  );
  assert.equal(
    cloudDeadlineState({
      now,
      mustSucceedBy: new Date("2026-07-19T11:59:59.000Z"),
      executionBudgetSeconds: budget.executionBudgetSeconds,
    }),
    "missed",
  );
  assert.equal(budget.executionBudgetSeconds, 115 * 60);
});
