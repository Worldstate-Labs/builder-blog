import assert from "node:assert/strict";
import test from "node:test";
import {
  ClientOperationTimeoutError,
  runClientOperationWithTimeout,
} from "../src/lib/client-operation-timeout";

test("a pending client operation is aborted and rejected at its deadline", async () => {
  const operationSignals: AbortSignal[] = [];

  await assert.rejects(
    runClientOperationWithTimeout(
      (signal) => {
        operationSignals.push(signal);
        return new Promise<never>(() => {});
      },
      {
        timeoutMs: 10,
        timeoutMessage: "Creating the secure link took too long. Try again.",
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof ClientOperationTimeoutError);
      assert.equal(error.message, "Creating the secure link took too long. Try again.");
      return true;
    },
  );

  assert.equal(operationSignals[0]?.aborted, true);
});

test("a completed client operation returns its value before the deadline", async () => {
  const result = await runClientOperationWithTimeout(
    async (signal) => {
      assert.equal(signal.aborted, false);
      return "copied";
    },
    {
      timeoutMs: 1_000,
      timeoutMessage: "This should not time out.",
    },
  );

  assert.equal(result, "copied");
});

test("an operation failure is preserved instead of being reported as a timeout", async () => {
  const expected = new Error("request failed");

  await assert.rejects(
    runClientOperationWithTimeout(
      async () => {
        throw expected;
      },
      {
        timeoutMs: 1_000,
        timeoutMessage: "This should not time out.",
      },
    ),
    (error: unknown) => error === expected,
  );
});
