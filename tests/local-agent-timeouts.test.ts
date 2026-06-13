import assert from "node:assert/strict";
import test from "node:test";
import { localAgentShardTimeoutSeconds, localAgentTimeoutSeconds } from "../src/lib/local-agent-timeouts";

test("local agent timeout policy is shared and clamps expected cron windows", () => {
  assert.equal(localAgentTimeoutSeconds(30, "library-cron"), "1440");
  assert.equal(localAgentTimeoutSeconds(60, "library-cron"), "2880");
  assert.equal(localAgentTimeoutSeconds(180, "library-cron"), "4500");
  assert.equal(localAgentTimeoutSeconds(1440, "digest-cron"), "2700");
  assert.equal(localAgentTimeoutSeconds(0, "library-cron"), "2880");
  assert.equal(localAgentShardTimeoutSeconds(1440), "1080");
});
