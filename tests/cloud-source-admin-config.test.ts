import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCloudFetchConfigPatchInput,
  normalizeCloudLanguageLibraryPatchInput,
} from "../src/lib/cloud-source-config";

test("cloud fetch config patch accepts bounded scheduler controls", () => {
  const normalized = normalizeCloudFetchConfigPatchInput({
    maxTasksPerHour: 50,
    maxActiveLeases: 20,
    workerSecondsPerHour: 7200,
    defaultBatchSize: 10,
    leaseTtlMinutes: 90,
    schedulingLeadMinutes: 120,
    planningHorizonHours: 72,
    retryBaseMinutes: 30,
    starvationReserveRatio: 0.15,
    retryReserveRatio: 0.1,
    failureCircuitBreakerThreshold: 5,
    canonicalCooldownMinutes: 60,
    durationColdStartBufferRatio: 0.5,
  });

  assert.deepEqual(normalized, {
    maxTasksPerHour: 50,
    maxActiveLeases: 20,
    workerSecondsPerHour: 7200,
    defaultBatchSize: 10,
    leaseTtlMinutes: 90,
    schedulingLeadMinutes: 120,
    planningHorizonHours: 72,
    retryBaseMinutes: 30,
    starvationReserveRatio: 0.15,
    retryReserveRatio: 0.1,
    failureCircuitBreakerThreshold: 5,
    canonicalCooldownMinutes: 60,
    durationColdStartBufferRatio: 0.5,
  });
});

test("cloud fetch config patch rejects unsafe scheduler budgets", () => {
  assert.throws(
    () => normalizeCloudFetchConfigPatchInput({ maxTasksPerHour: 0 }),
    /maxTasksPerHour/,
  );
  assert.throws(
    () => normalizeCloudFetchConfigPatchInput({ workerSecondsPerHour: 59 }),
    /workerSecondsPerHour/,
  );
  assert.throws(
    () => normalizeCloudFetchConfigPatchInput({ durationColdStartBufferRatio: 2.01 }),
    /durationColdStartBufferRatio/,
  );
});

test("cloud language library patch resolves fixed language and owner lookup", () => {
  const normalized = normalizeCloudLanguageLibraryPatchInput({
    summaryLanguage: " Chinese ",
    ownerEmail: "cloud-zh@example.com ",
    enabled: false,
  });

  assert.deepEqual(normalized, {
    summaryLanguage: "Chinese",
    ownerEmail: "cloud-zh@example.com",
    ownerUserId: null,
    enabled: false,
  });
});

test("cloud language library patch rejects original/source language preference", () => {
  assert.throws(
    () => normalizeCloudLanguageLibraryPatchInput({ summaryLanguage: "source", ownerUserId: "user_1" }),
    /fixed summary language/,
  );
});
