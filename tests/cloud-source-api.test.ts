import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  CLOUD_SOURCE_SUBMISSION_LIMIT,
  normalizeCloudSourceSubmissionInput,
} from "../src/lib/cloud-source-contracts";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("cloud source submission route authenticates, normalizes input, and rate limits", () => {
  const route = source("src/app/api/cloud-library/source-submissions/route.ts");

  assert.match(route, /getCurrentSession\(\)/);
  assert.match(route, /normalizeCloudSourceSubmissionInput/);
  assert.match(route, /builderIds: body\?\.builderIds/);
  assert.match(route, /submitUserPrivateLibraryToCloud/);
  assert.match(route, /builderIds: input\.builderIds/);
  assert.match(route, /CLOUD_SUBMISSION_RATE_LIMIT_MS/);
  assert.match(route, /sourcesSubmitted/);
  assert.match(route, /tasksSubmitted/);
  assert.doesNotMatch(route, /getUserFromBearer/);
  assert.doesNotMatch(route, /AgentToken/);
});

test("cloud source submission input limits selected source ids", () => {
  assert.equal(CLOUD_SOURCE_SUBMISSION_LIMIT, 20);
  const input = normalizeCloudSourceSubmissionInput({
    frequency: "week",
    summaryLanguage: "zh",
    builderIds: ["builder_1", "builder_1", "builder_2"],
  });

  assert.deepEqual(input.builderIds, ["builder_1", "builder_2"]);
  assert.throws(
    () =>
      normalizeCloudSourceSubmissionInput({
        frequency: "day",
        summaryLanguage: "zh",
        builderIds: Array.from({ length: CLOUD_SOURCE_SUBMISSION_LIMIT + 1 }, (_, index) => `b_${index}`),
      }),
    /at most 20 sources/,
  );
});

test("cloud source library submission copies only private sources to language owner", () => {
  const library = source("src/lib/cloud-source-library.ts");

  assert.match(library, /CLOUD_SOURCE_SUBMISSION_LIMIT/);
  assert.match(library, /selectedBuilderIds/);
  assert.match(library, /Select up to \$\{CLOUD_SOURCE_SUBMISSION_LIMIT\} sources/);
  assert.match(library, /Some selected sources are not in your library/);
  assert.match(library, /ensureCloudLanguageLibraryForSubmission/);
  assert.match(library, /upsertCloudLanguageLibraryWithSystemOwner/);
  assert.match(library, /BuilderPoolOrigin\.PERSONAL_SYNC/);
  assert.match(library, /builder:\s*\{\s*ownerUserId: params\.userId\s*\}/);
  assert.match(library, /copyBuilderToCloudOwner/);
  assert.match(library, /cloudOwnerUserId: cloudLibrary\.ownerUserId/);
  assert.match(library, /cloudSourceSubmission\.upsert/);
  assert.match(library, /recomputeCloudSourceTask/);
  assert.match(library, /syncCloudLanguageLibraryHub/);
  assert.match(library, /activeCloudBuilderIds/);
  assert.match(library, /builderIds: activeCloudBuilderIds/);
  assert.match(library, /languagesToSync/);
});

test("cloud language hub entries stay internal to cloud reuse", () => {
  const hub = source("src/lib/library-hub.ts");
  const hubPage = source("src/app/(workspace)/library-hub/page.tsx");
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");

  assert.match(hub, /export function userImportableLibraryHubEntryWhere/);
  assert.match(hub, /cloudLanguageLibrary:\s*\{\s*is:\s*null\s*\}/);
  assert.match(hub, /\.\.\.userImportableLibraryHubEntryWhere\(\)/);
  assert.match(hubPage, /where:\s*userImportableLibraryHubEntryWhere\(\)/);
  assert.match(buildersPage, /hubEntry:\s*userImportableLibraryHubEntryWhere\(\)/);
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
  assert.match(languageRoute, /upsertCloudLanguageLibraryWithSystemOwner/);
  assert.doesNotMatch(languageRoute, /ownerEmail/);
  assert.doesNotMatch(languageRoute, /findCloudLibraryOwner/);
});

test("admin cloud fetch sync route uses admin auth and cloud sync status helper", () => {
  const syncRoute = source("src/app/api/admin/cloud-fetch/sync/route.ts");

  assert.match(syncRoute, /requireCloudFetchAdmin\(request\)/);
  assert.match(syncRoute, /parseCloudFetchSyncPayload/);
  assert.match(syncRoute, /syncBuilderFeedItems/);
  assert.match(syncRoute, /cloudSourceTask\.findMany/);
  assert.match(syncRoute, /allowedBuilderIds/);
  assert.match(syncRoute, /reconcileTaskResultsWithFeedSync/);
  assert.match(syncRoute, /taskOutcomes:\s*parsed\.data\.taskOutcomes/);
  assert.match(syncRoute, /serverTaskOutcomes/);
  assert.match(syncRoute, /applyCloudFetchTaskSyncResult/);
  assert.match(syncRoute, /sourceTaskResult/);
  assert.match(syncRoute, /runSummary/);
  assert.match(syncRoute, /upsertSourceCandidateFromCloudBuilder/);
  assert.match(syncRoute, /syncCloudLanguageLibraryHub/);
  assert.match(syncRoute, /taskResult\.status === "succeeded"/);
  assert.match(syncRoute, /feedSync/);
  assert.match(syncRoute, /loadCloudFetchSyncConfig/);
  assert.match(syncRoute, /NextResponse\.json\(\{ error: "Unauthorized" \}/);
});

test("admin cloud fetch sync route keeps skipped post outcomes out of source failure counts", () => {
  const syncRoute = source("src/app/api/admin/cloud-fetch/sync/route.ts");

  assert.match(syncRoute, /deriveCloudFetchOutcomeSummary/);
  assert.match(syncRoute, /observedPosts/);
  assert.match(syncRoute, /sourceTaskOutcomes/);
  assert.doesNotMatch(syncRoute, /sourceTaskOutcomes\.length,\s*\)/);
  assert.doesNotMatch(syncRoute, /firstOutcomeReason = sourceTaskOutcomes/);
});

test("cloud fetch log surfaces do not render raw source-level failure reasons as red text", () => {
  const adminLog = source("src/components/AdminCloudFetchLog.tsx");
  const sourceLogItem = source("src/components/CloudSourceLogItem.tsx");
  const panel = source("src/components/FetchLogPanel.tsx");
  const styles = source("src/app/globals.css");

  for (const component of [adminLog, sourceLogItem]) {
    assert.doesNotMatch(component, /cloud-fetch-log-task-error/);
    assert.doesNotMatch(component, /<p[^>]*>\{[^}]*failureReason[^}]*\}<\/p>/);
  }
  assert.doesNotMatch(styles, /cloud-fetch-log-task-error/);
  assert.match(panel, /from "@\/lib\/fetch-failure-taxonomy"/);
  assert.match(source("src/lib/fetch-failure-taxonomy.ts"), /no_primary_content:[\s\S]*No primary content/);
});

test("cloud source scheduler exposes DB-backed materialize and lease workflows", () => {
  const scheduler = source("src/lib/cloud-source-scheduler.ts");

  assert.match(scheduler, /export async function materializeDueCloudFetchQueue/);
  assert.match(scheduler, /export async function leaseCloudFetchTasks/);
  assert.match(scheduler, /planCloudFetchWindow/);
  assert.match(scheduler, /CloudFetchQueueItem_active_task_key/);
  assert.match(scheduler, /tokenBudgetPerHour/);
  assert.match(scheduler, /requestedLimit/);
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

test("cloud submission route lets the user stop their active cloud fetch submissions", () => {
  const route = source("src/app/api/cloud-library/source-submissions/route.ts");

  assert.match(route, /export async function DELETE/);
  assert.match(route, /getCurrentSession\(\)/);
  assert.match(route, /stopUserCloudSourceSubmissions\(\{ userId \}\)/);
  assert.match(route, /stoppedSources/);
  assert.match(route, /cancelledQueuedTasks/);
});

test("cloud scheduler is work-conserving: releases by nextAttemptAt, no latest-bucket deferral", () => {
  const scheduler = source("src/lib/cloud-source-scheduler.ts");

  // releaseAt is no longer pushed forward to (mustSucceedBy - schedulingLeadMinutes),
  // and the latest-feasible-bucket parking strategy is gone.
  assert.doesNotMatch(scheduler, /const targetStartAt =/);
  assert.match(scheduler, /releaseAt = maxDate\(params\.now, task\.nextAttemptAt/);
  assert.doesNotMatch(scheduler, /latestFeasibleBucket/);
});
