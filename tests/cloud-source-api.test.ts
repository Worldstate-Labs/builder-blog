import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("cloud source submission route authenticates, normalizes input, and rate limits", () => {
  const route = source("src/app/api/cloud-library/source-submissions/route.ts");

  assert.match(route, /getCurrentSession\(\)/);
  assert.match(route, /normalizeCloudSourceSubmissionInput/);
  assert.match(route, /submitUserPrivateLibraryToCloud/);
  assert.match(route, /CLOUD_SUBMISSION_RATE_LIMIT_MS/);
  assert.match(route, /sourcesSubmitted/);
  assert.match(route, /tasksSubmitted/);
  assert.doesNotMatch(route, /getUserFromBearer/);
  assert.doesNotMatch(route, /AgentToken/);
});

test("cloud source library submission copies only private sources to language owner", () => {
  const library = source("src/lib/cloud-source-library.ts");

  assert.match(library, /resolveCloudLanguageLibrary/);
  assert.match(library, /BuilderPoolOrigin\.PERSONAL_SYNC/);
  assert.match(library, /builder:\s*\{\s*ownerUserId: params\.userId\s*\}/);
  assert.match(library, /copyBuilderToCloudOwner/);
  assert.match(library, /cloudOwnerUserId: cloudLibrary\.ownerUserId/);
  assert.match(library, /cloudSourceSubmission\.upsert/);
  assert.match(library, /recomputeCloudSourceTask/);
  assert.match(library, /syncCloudLanguageLibraryHub/);
});

test("admin cloud fetch queue and lease routes support session or bearer admin auth", () => {
  const queueRoute = source("src/app/api/admin/cloud-fetch/queue/route.ts");
  const leaseRoute = source("src/app/api/admin/cloud-fetch/lease/route.ts");
  const heartbeatRoute = source("src/app/api/admin/cloud-fetch/heartbeat/route.ts");
  const adminHelper = source("src/lib/cloud-source-admin.ts");

  for (const route of [queueRoute, leaseRoute, heartbeatRoute]) {
    assert.match(route, /requireCloudFetchAdmin\(request\)/);
    assert.match(route, /NextResponse\.json\(\{ error: "Unauthorized" \}/);
  }
  assert.match(adminHelper, /getCurrentSession\(\)/);
  assert.match(adminHelper, /getUserFromBearer\(request\)/);
  assert.match(adminHelper, /isAdminEmail/);
  assert.match(queueRoute, /materializeDueCloudFetchQueue/);
  assert.match(leaseRoute, /leaseCloudFetchTasks/);
  assert.match(heartbeatRoute, /heartbeatCloudFetchRun/);
});

test("admin cloud fetch config routes validate patches behind admin auth", () => {
  const configRoute = source("src/app/api/admin/cloud-fetch/config/route.ts");
  const languageRoute = source("src/app/api/admin/cloud-fetch/language-libraries/route.ts");

  for (const route of [configRoute, languageRoute]) {
    assert.match(route, /requireCloudFetchAdmin\(request\)/);
    assert.match(route, /NextResponse\.json\(\{ error: "Unauthorized" \}/);
  }
  assert.match(configRoute, /normalizeCloudFetchConfigPatchInput/);
  assert.match(configRoute, /cloudFetchConfig\.upsert/);
  assert.match(languageRoute, /normalizeCloudLanguageLibraryPatchInput/);
  assert.match(languageRoute, /cloudLanguageLibrary\.upsert/);
  assert.match(languageRoute, /ownerEmail/);
});

test("admin cloud fetch sync route uses admin auth and cloud sync status helper", () => {
  const syncRoute = source("src/app/api/admin/cloud-fetch/sync/route.ts");

  assert.match(syncRoute, /requireCloudFetchAdmin\(request\)/);
  assert.match(syncRoute, /parseCloudFetchSyncPayload/);
  assert.match(syncRoute, /syncBuilderFeedItems/);
  assert.match(syncRoute, /cloudSourceTask\.findMany/);
  assert.match(syncRoute, /allowedBuilderIds/);
  assert.match(syncRoute, /reconcileTaskResultsWithFeedSync/);
  assert.match(syncRoute, /applyCloudFetchTaskSyncResult/);
  assert.match(syncRoute, /upsertSourceCandidateFromCloudBuilder/);
  assert.match(syncRoute, /syncCloudLanguageLibraryHub/);
  assert.match(syncRoute, /taskResult\.status === "succeeded"/);
  assert.match(syncRoute, /feedSync/);
  assert.match(syncRoute, /loadCloudFetchSyncConfig/);
  assert.match(syncRoute, /NextResponse\.json\(\{ error: "Unauthorized" \}/);
});

test("cloud source scheduler exposes DB-backed materialize and lease workflows", () => {
  const scheduler = source("src/lib/cloud-source-scheduler.ts");

  assert.match(scheduler, /export async function materializeDueCloudFetchQueue/);
  assert.match(scheduler, /export async function leaseCloudFetchTasks/);
  assert.match(scheduler, /planCloudFetchWindow/);
  assert.match(scheduler, /CloudFetchQueueItem_active_task_key/);
  assert.match(scheduler, /workerSecondsPerHour/);
  assert.match(scheduler, /maxActiveLeases/);
  assert.match(scheduler, /leaseExpiresAt/);
});

test("cloud submission reconciles to a single active submission and cancels superseded fetches", () => {
  const library = source("src/lib/cloud-source-library.ts");

  assert.match(library, /planSubmissionReconciliation/);
  assert.match(library, /cloudSourceSubmission\.findMany/);
  assert.match(library, /cloudSourceSubmission\.updateMany/);
  assert.match(library, /active: false/);
  assert.match(library, /cancelQueuedCloudFetchForTasks/);
});

test("cloud submission route exposes a GET summary of the user's active submission", () => {
  const route = source("src/app/api/cloud-library/source-submissions/route.ts");

  assert.match(route, /export async function GET/);
  assert.match(route, /getCurrentSession\(\)/);
  assert.match(route, /getUserCloudSubmissionSummary/);
  assert.match(route, /hasActiveSubmission/);
});
