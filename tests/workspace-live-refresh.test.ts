import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("workspace refresh coordinator checks immediately and coalesces local refresh requests", () => {
  const autoRefresh = source("src/components/WorkspaceAutoRefresh.tsx");
  const events = source("src/lib/content-sync-events.ts");

  assert.match(events, /workspaceRefreshRequested/);
  assert.match(events, /requestWorkspaceRefresh/);
  assert.match(autoRefresh, /visibleCheckIntervalMs = 15_000/);
  assert.match(autoRefresh, /initialCheck = window\.setTimeout/);
  assert.match(autoRefresh, /window\.addEventListener\(workspaceRefreshRequested/);
  assert.match(autoRefresh, /queuedForceRefresh/);
  assert.match(autoRefresh, /forceRefresh/);
  assert.match(autoRefresh, /document\.visibilityState !== "visible"/);
  assert.match(autoRefresh, /window\.addEventListener\("pageshow"/);
});

test("workspace freshness fingerprint covers every externally mutable workspace data group", () => {
  const state = source("src/lib/content-sync-state.ts");
  const libraryState = source("src/lib/builder-library-state.ts");
  const route = source("src/app/api/content-state/route.ts");
  const layout = source("src/app/(workspace)/layout.tsx");

  for (const model of [
    "agentJobRun",
    "cronJobStatusEvent",
    "cloudSourceSubmission",
    "cloudSourceTask",
    "cloudFetchQueueItem",
    "cloudFetchRunTask",
    "feedRead",
    "feedFavorite",
    "recommendationSnapshot",
    "userChannelPreference",
    "userLibraryVisibility",
    "libraryHubItem",
  ]) {
    assert.match(state, new RegExp(`${model}\\.`), `missing ${model} freshness signal`);
  }
  for (const adminModel of [
    "sourceCandidate",
    "backupSourceCandidate",
    "sourceTypeConfig",
    "digestConfig",
    "cloudFetchConfig",
    "cloudLanguageLibrary",
    "cloudFetchRun",
  ]) {
    assert.match(state, new RegExp(`${adminModel}\\.`), `missing admin ${adminModel} freshness signal`);
  }
  assert.match(state, /isAdmin/);
  assert.match(state, /cloudBuilderIds/);
  assert.match(libraryState, /updatedAt: true/);
  assert.match(route, /isAdminEmail/);
  assert.match(route, /contentSyncState\(session\.user\.id, \{ isAdmin \}\)/);
  assert.match(layout, /contentSyncState\(session\.user\.id, \{ isAdmin \}\)/);
});

test("mutable rows expose monotonic updatedAt signals for in-place refresh", () => {
  const schema = source("prisma/schema.prisma");
  const migrationPath = "prisma/migrations/000088_workspace_live_refresh_versions/migration.sql";

  for (const model of [
    "FeedItem",
    "FeedRead",
    "FeedFavorite",
    "UserLibraryVisibility",
    "CloudFetchRun",
    "CloudFetchRunTask",
  ]) {
    const block = schema.slice(schema.indexOf(`model ${model} {`));
    assert.match(
      block.slice(0, block.indexOf("\n}")),
      /updatedAt\s+DateTime\s+@updatedAt/,
      `${model} needs updatedAt`,
    );
  }
  assert.ok(existsSync(join(root, migrationPath)), "workspace refresh migration is missing");
  const migration = source(migrationPath);
  assert.match(migration, /ALTER TABLE "FeedItem"/);
  assert.match(migration, /ALTER TABLE "CloudFetchRunTask"/);
});

test("user FollowBrief fetch log has an authenticated live endpoint and shared loader", () => {
  const loader = source("src/lib/user-cloud-fetch-log-data.ts");
  const route = source("src/app/api/cloud-library/fetch-log/route.ts");
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  const tabs = source("src/components/SourceSyncLogTabs.tsx");

  assert.match(loader, /export async function loadUserCloudFetchLog/);
  assert.match(loader, /cloudSourceSubmission\.findMany/);
  assert.match(loader, /serializeUserCloudFetchLog/);
  assert.match(route, /getCurrentSession/);
  assert.match(route, /loadUserCloudFetchLog\(session\.user\.id\)/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(buildersPage, /loadUserCloudFetchLog\(user\.id\)/);
  assert.doesNotMatch(buildersPage, /rawCloudSubmissions/);
  assert.match(tabs, /fetch\("\/api\/cloud-library\/fetch-log"/);
  assert.match(tabs, /requestWorkspaceRefresh/);
});

test("all live logs use 5 second running and 15 second idle polling", () => {
  const files = [
    "src/components/FetchLogPanel.tsx",
    "src/components/DigestLogPanel.tsx",
    "src/components/SourceSyncLogTabs.tsx",
    "src/components/AdminCloudFetchLog.tsx",
    "src/components/AdminCloudLibraryLiveProvider.tsx",
  ];
  for (const path of files) {
    const text = source(path);
    assert.match(text, /LIVE_POLL_RUNNING_MS/, `${path} must use running cadence`);
    assert.match(text, /LIVE_POLL_IDLE_MS/, `${path} must use idle cadence`);
  }
  for (const path of [
    "src/components/FetchLogPanel.tsx",
    "src/components/DigestLogPanel.tsx",
    "src/components/SourceSyncLogTabs.tsx",
    "src/components/AdminCloudFetchLog.tsx",
    "src/components/AdminCloudLibraryLiveProvider.tsx",
  ]) {
    assert.match(source(path), /requestWorkspaceRefresh/, `${path} must notify workspace refresh`);
  }
});

test("agent fetch live refresh removes rows deleted by RESET", () => {
  const panel = source("src/components/FetchLogPanel.tsx");

  assert.match(panel, /function reconcileLiveFetchRunLists/);
  assert.match(panel, /function reconcileLiveAgentJobRunLists/);
  assert.match(panel, /setRuns\(\(current\) => reconcileLiveFetchRunLists\(current, bodyRuns\)\)/);
  assert.match(panel, /setJobRuns\(\(current\) => reconcileLiveAgentJobRunLists\(current, bodyJobRuns\)\)/);
  assert.match(panel, /if \(incoming\.length === 0\) return \[\]/);
});

test("client-owned feed state reconciles after server freshness changes", () => {
  const following = source("src/components/FollowingRecommendationSection.tsx");
  const digestDetails = source("src/components/DigestDetails.tsx");
  const favorites = source("src/components/FavoritePostsList.tsx");
  const builderActions = source("src/components/BuilderLibraryActions.tsx");
  const detailActions = source("src/components/BuilderDetailActions.tsx");
  const postFavorite = source("src/components/PostFavoriteControl.tsx");

  assert.match(following, /contentSyncStateChanged/);
  assert.match(following, /window\.addEventListener\(contentSyncStateChanged/);
  assert.match(following, /liveDataSignature\(visibleSnapshots\)/);
  assert.match(digestDetails, /window\.addEventListener\(contentSyncStateChanged/);
  assert.match(favorites, /initialItems/);
  assert.match(favorites, /initialItemsSignature/);
  assert.match(favorites, /canReconcileServerItems/);
  assert.match(builderActions, /initialSubscribed/);
  assert.match(builderActions, /useEffect/);
  assert.match(detailActions, /initialSubscribed/);
  assert.match(detailActions, /useEffect/);
  assert.match(postFavorite, /initialIsFavorite/);
  assert.match(postFavorite, /useEffect/);
});
