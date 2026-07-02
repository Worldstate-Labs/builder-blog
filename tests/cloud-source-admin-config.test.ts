import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCloudFetchConfigPatchInput,
  normalizeCloudLanguageLibraryPatchInput,
} from "../src/lib/cloud-source-config";

test("cloud fetch config patch accepts bounded scheduler controls", () => {
  const normalized = normalizeCloudFetchConfigPatchInput({
    tokenBudgetPerHour: 2_000_000,
    leaseTtlMinutes: 90,
    schedulingLeadMinutes: 120,
    retryBaseMinutes: 30,
    starvationReserveRatio: 0.15,
    failureCircuitBreakerThreshold: 5,
    canonicalCooldownMinutes: 60,
    durationColdStartBufferRatio: 0.5,
  });

  assert.deepEqual(normalized, {
    tokenBudgetPerHour: 2_000_000,
    leaseTtlMinutes: 90,
    schedulingLeadMinutes: 120,
    retryBaseMinutes: 30,
    starvationReserveRatio: 0.15,
    failureCircuitBreakerThreshold: 5,
    canonicalCooldownMinutes: 60,
    durationColdStartBufferRatio: 0.5,
  });
});

test("cloud fetch config patch rejects unsafe scheduler budgets", () => {
  assert.throws(
    () => normalizeCloudFetchConfigPatchInput({ tokenBudgetPerHour: 999 }),
    /tokenBudgetPerHour/,
  );
  assert.throws(
    () => normalizeCloudFetchConfigPatchInput({ durationColdStartBufferRatio: 2.01 }),
    /durationColdStartBufferRatio/,
  );
});

test("cloud fetch config patch rejects removed server-side concurrency knobs", () => {
  for (const key of [
    "maxTasksPerHour",
    "workerSecondsPerHour",
    "maxActiveLeases",
    "defaultBatchSize",
    "planningHorizonHours",
    "retryReserveRatio",
  ]) {
    assert.throws(
      () => normalizeCloudFetchConfigPatchInput({ [key]: 1 }),
      new RegExp(key),
    );
  }
});

test("cloud language library patch resolves fixed language without user-configured owner", () => {
  const normalized = normalizeCloudLanguageLibraryPatchInput({
    summaryLanguage: " Chinese ",
    enabled: false,
  });

  assert.deepEqual(normalized, {
    summaryLanguage: "Chinese",
    enabled: false,
  });
});

test("cloud language library patch rejects user-configured owner fields", () => {
  assert.throws(
    () => normalizeCloudLanguageLibraryPatchInput({
      summaryLanguage: "zh",
      ownerEmail: "cloud-zh@example.com",
    }),
    /ownerEmail/,
  );
  assert.throws(
    () => normalizeCloudLanguageLibraryPatchInput({
      summaryLanguage: "zh",
      ownerUserId: "user_1",
    }),
    /ownerUserId/,
  );
});

test("cloud language library patch rejects original/source language preference", () => {
  assert.throws(
    () => normalizeCloudLanguageLibraryPatchInput({ summaryLanguage: "source" }),
    /fixed summary language/,
  );
});
