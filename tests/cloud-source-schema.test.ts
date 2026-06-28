import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("Prisma schema declares cloud language libraries and source fetch tasks", () => {
  const schema = source("prisma/schema.prisma");

  for (const model of [
    "CloudFetchConfig",
    "CloudLanguageLibrary",
    "CloudSourceSubmission",
    "CloudSourceTask",
    "CloudFetchQueueItem",
    "CloudFetchRun",
    "CloudFetchRunTask",
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\{`), `missing ${model}`);
  }

  for (const enumName of [
    "CloudFetchFrequency",
    "CloudSourceTaskStatus",
    "CloudFetchQueueStatus",
    "CloudFetchRunStatus",
  ]) {
    assert.match(schema, new RegExp(`enum ${enumName} \\{`), `missing ${enumName}`);
  }

  assert.match(schema, /model CloudLanguageLibrary \{[\s\S]*summaryLanguage\s+String\s+@unique/);
  assert.match(schema, /model CloudLanguageLibrary \{[\s\S]*ownerUserId\s+String\s+@unique/);
  assert.match(schema, /model CloudLanguageLibrary \{[\s\S]*hubEntryId\s+String\?\s+@unique/);
  assert.match(schema, /model CloudSourceTask \{[\s\S]*builderId\s+String\s+@unique/);
  assert.match(schema, /model CloudSourceSubmission \{[\s\S]*@@unique\(\[userId, cloudBuilderId\]\)/);
});

test("cloud fetch config and tasks include duration-aware scheduling safeguards", () => {
  const schema = source("prisma/schema.prisma");

  for (const field of [
    "maxTasksPerHour",
    "maxActiveLeases",
    "workerSecondsPerHour",
    "planningHorizonHours",
    "starvationReserveRatio",
    "retryReserveRatio",
    "failureCircuitBreakerThreshold",
    "canonicalCooldownMinutes",
    "durationColdStartBufferRatio",
  ]) {
    assert.match(schema, new RegExp(`\\n\\s*${field}\\s+`), `CloudFetchConfig is missing ${field}`);
  }

  for (const field of [
    "consecutiveDeferrals",
    "lastDeferredAt",
    "estimatedDurationSeconds",
    "estimatedSuccessProbability",
    "durationP50Seconds",
    "durationP75Seconds",
    "durationP90Seconds",
    "durationSampleCount",
    "successSampleCount",
    "circuitBreakerUntil",
    "circuitBreakerReason",
  ]) {
    assert.match(schema, new RegExp(`\\n\\s*${field}\\s+`), `CloudSourceTask is missing ${field}`);
  }

  for (const field of [
    "estimatedDurationSeconds",
    "actualDurationSeconds",
    "successProbabilitySnapshot",
  ]) {
    assert.match(schema, new RegExp(`\\n\\s*${field}\\s+`), `CloudFetchRunTask is missing ${field}`);
  }
});

test("cloud source fetch migration creates queue uniqueness and foreign keys", () => {
  const migration = source("prisma/migrations/000080_cloud_source_fetch/migration.sql");

  for (const table of [
    "CloudFetchConfig",
    "CloudLanguageLibrary",
    "CloudSourceSubmission",
    "CloudSourceTask",
    "CloudFetchQueueItem",
    "CloudFetchRun",
    "CloudFetchRunTask",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`), `migration missing ${table}`);
  }

  assert.match(migration, /CREATE UNIQUE INDEX "CloudFetchQueueItem_active_task_key"/);
  assert.match(migration, /WHERE "status" IN \('QUEUED', 'LEASED'\)/);
  assert.match(migration, /REFERENCES "Builder"\("id"\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES "LibraryHubEntry"\("id"\) ON DELETE SET NULL/);
});
