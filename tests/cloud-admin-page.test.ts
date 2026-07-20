import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("admin cloud fetch runs route is admin-gated and serializes worker host plus source deliveries", () => {
  const route = source("src/app/api/admin/cloud-fetch/runs/route.ts");

  assert.match(route, /export async function GET/);
  assert.match(route, /requireCloudFetchAdmin\(request\)/);
  assert.match(route, /NextResponse\.json\(\{ error: auth\.error \}/);
  assert.match(route, /cloudFetchRun\.findMany/);
  assert.match(route, /serializeCloudFetchRun/);
  assert.match(route, /serializeCloudWorkerHost/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(route, /leaseBatches/);
  assert.match(route, /workerHost/);
  assert.match(route, /builder: \{ select: \{ name: true, sourceType: true \} \}/);
});

test("cloud-library management page is admin-gated and mounts the cloud monitor sections", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");

  assert.match(page, /isAdminEmail/);
  assert.match(page, /redirect\(/);
  assert.match(page, /AdminCloudFetchRunActions/);
  assert.match(page, /AdminCloudFetchLog/);
  assert.match(page, /Cloud fetch monitor/);
  assert.match(page, /AdminCloudLibraryMaintenancePanel/);
  // The scheduler config form was moved here from the main Settings page.
  assert.match(page, /AdminCloudFetchConfigForm/);
  assert.match(page, /CLOUD_FETCH_CONFIG_ID/);
});

test("cloud output pools are automatic and only expose pause controls", () => {
  const form = source("src/components/AdminCloudFetchConfigForm.tsx");

  assert.match(form, /Cloud output pools/);
  assert.match(form, /created automatically from Cloud submissions/);
  assert.match(form, /function setLanguageLibraryEnabled/);
  assert.match(form, /summaryLanguage: library\.summaryLanguage/);
  assert.match(form, /library\.enabled \? "Pause" : "Activate"/);
  assert.doesNotMatch(form, /System owner:/);
  assert.doesNotMatch(form, /FieldSelect/);
  assert.doesNotMatch(form, /label="Summary language"/);
  assert.doesNotMatch(form, /label="Output language"/);
  assert.doesNotMatch(form, /Save output library/);
});

test("cloud library maintenance reset is admin-gated and scoped to cloud generated state", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");
  const panel = source("src/components/AdminCloudLibraryMaintenancePanel.tsx");
  const route = source("src/app/api/admin/cloud-fetch/reset/route.ts");
  const helper = source("src/lib/cloud-library-reset.ts");

  assert.match(page, /Cloud library maintenance/);
  assert.match(panel, /Reset Cloud library posts and fetch records/);
  assert.match(panel, /\/api\/admin\/cloud-fetch\/reset/);
  assert.match(panel, /RESET/);
  assert.match(panel, /contentSyncStateChanged/);
  assert.match(panel, /window\.dispatchEvent\(new Event\(contentSyncStateChanged\)\)/);
  assert.match(route, /requireCloudFetchAdmin/);
  assert.match(route, /resetCloudLibraryGeneratedState/);
  assert.match(route, /confirmation[\s\S]*RESET/);
  assert.match(helper, /cloudLanguageLibrary\.findMany/);
  assert.match(helper, /feedItem\.deleteMany\(\{[\s\S]*builderId: \{ in: builderIds \}/);
  assert.match(helper, /cloudFetchQueueItem\.deleteMany\(\{[\s\S]*cloudSourceTaskId: \{ in: sourceTaskIds \}/);
  assert.match(helper, /cloudFetchRunTask\.deleteMany\(\{[\s\S]*cloudSourceTaskId: \{ in: sourceTaskIds \}/);
  assert.match(helper, /cloudFetchRun\.deleteMany\(\)/);
  assert.match(helper, /agentJobRun\.deleteMany\(\{[\s\S]*jobType: "cloud-library-fetch"/);
  assert.match(helper, /cloudSourceSubmission\.groupBy/);
  assert.match(helper, /cloudSourceTask\.updateMany/);
  assert.match(helper, /status: "PAUSED"/);
  assert.match(helper, /builder\.updateMany\(\{[\s\S]*ownerUserId: \{ in: ownerIds \}/);
  assert.doesNotMatch(helper, /cloudSourceSubmission\.deleteMany/);
  assert.doesNotMatch(helper, /cloudLanguageLibrary\.deleteMany/);
});

test("settings page links to the cloud library management route for admins", () => {
  const page = source("src/app/(workspace)/settings/page.tsx");

  assert.match(page, /\/settings\/cloud-library/);
});

test("copy-prompt jobs for cloud worker host setup and stop are whitelisted", () => {
  const jobs = source("src/lib/skill-job-files.ts");

  assert.match(jobs, /"cloud-library-cron-setup":/);
  assert.match(jobs, /"cloud-library-cron-stop":/);
  assert.match(jobs, /"cloud-library-host":/);
  assert.doesNotMatch(jobs, /"cloud-library-once":/);
});

test("cloud run actions component copies worker host and stop prompts via short prompt links", () => {
  const actions = source("src/components/AdminCloudFetchRunActions.tsx");

  assert.match(actions, /cloud-library-cron-setup/);
  assert.match(actions, /cloud-library-cron-stop/);
  assert.doesNotMatch(actions, /cloud-library-once/);
  assert.match(actions, /\/api\/settings\/tokens\/\$\{tokenId\}\/prompt-links/);
  assert.match(actions, /JSON\.stringify\(\{ job, options \}/);
  assert.match(actions, /options:\s*\{/);
  assert.match(actions, /body:\s*JSON\.stringify/);
  assert.match(actions, /body\?\.url/);
  assert.match(actions, /Open \$\{url\} and follow the instructions\./);
  assert.doesNotMatch(actions, /exchange-code/);
  assert.doesNotMatch(actions, /\/api\/skill\/jobs\//);
  assert.doesNotMatch(actions, /URLSearchParams/);
  assert.doesNotMatch(actions, /cloud-run-cloud-limit/);
  assert.doesNotMatch(actions, /cloud-run-post-limit/);
  assert.match(actions, /cloud-run-fetch-days/);
  assert.match(actions, /cloud-run-parallel-workers/);
  assert.match(actions, /const PARALLEL_WORKERS_DEFAULT = 10/);
  assert.match(actions, /const PARALLEL_WORKERS_MAX = 20/);
  assert.doesNotMatch(actions, /params\.set\("cloudLimit"/);
  assert.doesNotMatch(actions, /params\.set\("postLimit"/);
  assert.doesNotMatch(actions, /params\.set\("days"/);
  assert.doesNotMatch(actions, /params\.set\("parallel"/);
  assert.doesNotMatch(actions, /params\.set\("freq"/);
  assert.match(actions, /options\.fetchDays = fetchDaysValue/);
  assert.match(actions, /options\.parallelWorkers = parallelWorkersValue/);
});

test("cloud run actions expose host settings without a cadence selector", () => {
  const actions = source("src/components/AdminCloudFetchRunActions.tsx");

  assert.match(actions, /Copy worker host prompt/);
  assert.match(actions, /Copy stop cloud fetch prompt/);
  assert.match(actions, /CLOUD_WORKER_HOST_JOB/);
  assert.match(actions, /CLOUD_WORKER_STOP_JOB/);
  assert.doesNotMatch(actions, /FREQUENCY_OPTIONS/);
  assert.doesNotMatch(actions, /cloud-run-frequency/);
  assert.doesNotMatch(actions, /frequency === "once"/);
});

test("cloud fetch log component reads the admin runs endpoint", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  assert.match(log, /\/api\/admin\/cloud-fetch\/runs/);
  assert.match(log, /initialWorkerHost/);
  assert.match(log, /initialLeaseBatches/);
  assert.match(log, /workerHost/);
  assert.match(log, /leaseBatches/);
  assert.match(log, /Post task queue/);
  assert.match(log, /Worker lanes/);
  assert.match(log, /formatInlineUsage\(group\.usage\)/);
  assert.match(log, /formatInlineUsage\(usage\)/);
  assert.match(log, /Source deliveries/);
  assert.match(log, /Host id/);
  assert.match(log, /P\(success\)/);
  assert.match(log, /cache: "no-store"/);
  assert.match(log, /buildWorkerShardGroups/);
  assert.match(log, /fallbackMetrics/);
  assert.match(log, /contentSyncStateChanged/);
  assert.match(log, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(log, /This source is still running\. Post task outcomes appear after/);
  assert.match(log, /task\.plannedPosts === 0 &&[\s\S]*!task\.noGeneratedFetchTasks[\s\S]*!task\.finishedAt/);
  assert.match(log, /function formatPostOutcomeSummary\(\{[\s\S]*status/);
  assert.match(log, /planned > 0[\s\S]*Running without post tasks/);
  assert.match(log, /function workerShardTaskStatus\([\s\S]*entry\.liveTask\?\.status \?\? entry\.task\.status/);
  assert.match(log, /No post tasks were generated for this source/);
  assert.match(log, /emptySourceTaskMessage/);
  assert.match(log, /tasksClaimed/);
  assert.match(log, /pendingPosts/);
  assert.match(log, /function runtimeLabel/);
  assert.match(log, /workerHost\.runtime && workerHost\.model/);
  assert.match(log, /function skippedReasonSummary/);
  assert.match(log, /skippedReasonLabel/);
  assert.match(log, /Completed \/ planned/);
  assert.match(log, /Initial budget/);
  assert.match(log, /Deadline risk/);
  assert.match(log, /Must succeed by/);
  assert.match(log, /Historical estimate/);
  assert.match(log, /Historical P\(success\)/);
  assert.match(log, /workerHost\.hostname,\s*runtimeLabel\(workerHost\),/);
  assert.doesNotMatch(log, /workerHost\.platform,/);
  assert.doesNotMatch(log, /claimed\s*\{/);
  assert.doesNotMatch(log, /disabled=\{!hasPosts\}/);
  assert.doesNotMatch(log, /<strong>Estimated<\/strong>/);
  assert.doesNotMatch(log, /<strong>P\(success\)<\/strong>/);
});

test("offline worker host presents its retained summary as historical", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  assert.match(
    log,
    /workerHost\.status === "offline" && workerHost\.summary[\s\S]*Last reported:/,
  );
});

test("cloud worker host metrics wrap long stage and usage values", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");
  const styles = source("src/app/globals.css");

  assert.match(log, /cloud-worker-host-metric is-stage/);
  assert.match(log, /cloud-worker-host-metric is-usage/);
  assert.match(styles, /\.cloud-worker-host-metrics \{[\s\S]*display: flex;[\s\S]*flex-wrap: wrap;/);
  assert.match(styles, /\.cloud-worker-host-metric strong \{[^}]*overflow-wrap: anywhere;/);
  assert.match(styles, /\.cloud-worker-host-metric strong \{[^}]*white-space: normal;/);
  assert.doesNotMatch(styles, /\.cloud-worker-host-metric strong \{[^}]*text-overflow: ellipsis;/);
});

test("cloud management timestamps use the shared relative time renderer", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");
  const sourceLogItem = source("src/components/CloudSourceLogItem.tsx");

  for (const component of [log, sourceLogItem]) {
    assert.match(component, /@\/components\/RelativeTime/);
    assert.match(component, /<RelativeTime/);
    assert.doesNotMatch(component, /function format(?:Time|Date)\(/);
    assert.doesNotMatch(component, /Intl\.DateTimeFormat/);
    assert.doesNotMatch(component, /timeZone:\s*"UTC"/);
  }
});

test("cloud fetch log reuses the personal fetch log's per-post staged renderer", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  // Genuine reuse: import and render the personal FetchLogPanel's TaskRow so
  // each cloud post shows the same read → summarize → sync lifecycle and
  // per-stage debug, instead of a bespoke per-post row.
  assert.match(log, /import \{ TaskRow[^}]*\} from "@\/components\/FetchLogPanel"/);
  assert.match(log, /<TaskRow/);
  assert.match(log, /postToFetchTaskLog/);

  // FetchLogPanel exports the shared renderer and the types cloud maps into.
  const panel = source("src/components/FetchLogPanel.tsx");
  assert.match(panel, /export function TaskRow/);
  assert.match(panel, /export type FetchTaskLog/);
  assert.match(panel, /export type FetchTaskProgress/);
});

test("cloud source lifecycle does not treat a running zero-count task as no-posts complete", () => {
  const sourceLogItem = source("src/components/CloudSourceLogItem.tsx");

  assert.match(sourceLogItem, /const stillAwaitingPostResults = running && task\.plannedPosts === 0 && !task\.noGeneratedFetchTasks/);
  assert.match(sourceLogItem, /const noPosts = task\.noGeneratedFetchTasks \|\| \(!running && task\.plannedPosts === 0\)/);
  assert.match(sourceLogItem, /stillAwaitingPostResults \? "Waiting for results"/);
  assert.match(sourceLogItem, /function postOutcomeSummary\(task: CloudFetchRunLogTask\) \{[\s\S]*return "Waiting for results"/);
});

test("cloud source detail reuses source-level budget and deadline facts without exposing internal budget reason copy", () => {
  const sourceLogItem = source("src/components/CloudSourceLogItem.tsx");

  assert.match(sourceLogItem, /Initial budget/);
  assert.match(sourceLogItem, /Deadline risk/);
  assert.match(sourceLogItem, /Must succeed by/);
  assert.doesNotMatch(sourceLogItem, /Budget reason/);
});

test("cloud worker host uses a distinct jobType so it never leaks into a personal fetch log", () => {
  // Server accepts the cloud jobType.
  const jobRunsRoute = source("src/app/api/skill/job-runs/route.ts");
  assert.match(jobRunsRoute, /jobType: z\.enum\(\["library-fetch", "cloud-library-fetch", "digest-build"\]\)/);

  // The cloud management page and admin log endpoint read cloud-library-fetch
  // worker host progress...
  const cloudPage = source("src/app/(workspace)/settings/cloud-library/page.tsx");
  assert.match(cloudPage, /getAgentJobRuns\(userId, "cloud-library-fetch", 5\)/);
  assert.match(cloudPage, /serializeCloudWorkerHost/);
  assert.match(cloudPage, /initialWorkerHost/);
  const cloudRunsRoute = source("src/app/api/admin/cloud-fetch/runs/route.ts");
  assert.match(cloudRunsRoute, /getAgentJobRuns\(auth\.user\.id, "cloud-library-fetch", 5\)/);

  // ...while the personal fetch log stays on library-fetch (excludes cloud rounds).
  const personalFetchRuns = source("src/app/api/skill/fetch-runs/route.ts");
  assert.match(personalFetchRuns, /loadFetchRunHistoryAgentJobs\(/);
  const buildersPage = source("src/app/(workspace)/builders/page.tsx");
  assert.match(buildersPage, /loadFetchRunHistoryAgentJobs\(/);
  const agentJobRuns = source("src/lib/agent-job-runs.ts");
  assert.match(agentJobRuns, /jobType: "library-fetch"/);
  assert.match(
    agentJobRuns,
    /scheduleJob: "library-cron",\s*trigger: "scheduled"/,
  );
});

test("runner and CLI tag cloud rounds with the cloud-library-fetch jobType", () => {
  // Runner: job_type_for_name maps cloud-library-* to the cloud jobType.
  const runner = source("scripts/builder-agent-runner.sh");
  assert.match(runner, /cloud-library-\*\) printf '%s\\n' "cloud-library-fetch"/);

  // CLI live-progress emitter derives the jobType from BUILDER_BLOG_RUN_SOURCE=cloud
  // instead of hardcoding "library-fetch".
  const cli = source("scripts/builder-digest.mjs");
  assert.match(cli, /BUILDER_BLOG_RUN_SOURCE\?\.trim\(\) === "cloud"\s*\n?\s*\? "cloud-library-fetch"/);
  assert.match(cli, /jobType: envJobType\(\)/);
});

test("admin cloud source drill-down route is admin-gated and returns submitters", () => {
  const route = source("src/app/api/admin/cloud-fetch/sources/[builderId]/route.ts");

  assert.match(route, /export async function GET/);
  assert.match(route, /requireCloudFetchAdmin\(request\)/);
  assert.match(route, /cloudSourceSubmission\.findMany/);
  assert.match(route, /serializeCloudSourceSubmitter/);
});

test("cloud library explorer lists libraries and renders recent posts via BuilderFeedItems", () => {
  const explorer = source("src/components/AdminCloudLibraryExplorer.tsx");

  assert.match(explorer, /postCount/);
  assert.match(explorer, /submitterCount/);
  assert.match(explorer, /statusChipLabel/);
  assert.match(explorer, /CloudSourceLogItem/);
  assert.match(explorer, /showSubmitters=\{true\}/);
  assert.match(explorer, /\/api\/admin\/cloud-fetch\/sources\/\$\{builderId\}/);
  assert.match(explorer, /submitters: detail\?\.submitters/);
  assert.match(explorer, /useEffect\(\(\) => \{[\s\S]*const builderId = expanded[\s\S]*\/api\/admin\/cloud-fetch\/sources\/\$\{builderId\}[\s\S]*\}, \[expanded, libraries\]\)/);
  assert.doesNotMatch(explorer, /BuilderFeedItems/);
  assert.doesNotMatch(explorer, /showSubmitters=\{false\}/);
  assert.doesNotMatch(explorer, /className="cloud-source-head"/);
});

test("cloud library overview has a focused admin endpoint shared with the server page", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");
  const route = source("src/app/api/admin/cloud-fetch/libraries/route.ts");
  const data = source("src/lib/cloud-library-overview-data.ts");

  assert.match(page, /getCloudLibraryAdminSnapshot/);
  assert.match(route, /requireCloudFetchAdmin\(request\)/);
  assert.match(route, /getCloudLibraryAdminSnapshot/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(data, /cloudLanguageLibrary\.findMany/);
  assert.match(data, /cloudSourceSubmission\.groupBy/);
  assert.match(data, /feedItem\.groupBy/);
});

test("cloud library status refreshes while visible without refreshing editable config", () => {
  const provider = source("src/components/AdminCloudLibraryLiveProvider.tsx");
  const config = source("src/components/AdminCloudFetchConfigForm.tsx");

  assert.match(provider, /useEffect/);
  assert.match(provider, /\/api\/admin\/cloud-fetch\/libraries/);
  assert.match(provider, /cache: "no-store"/);
  assert.match(provider, /hasRunningSourceTask \? LIVE_POLL_RUNNING_MS : LIVE_POLL_IDLE_MS/);
  assert.match(provider, /document\.visibilityState === "visible"/);
  assert.match(provider, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(provider, /contentSyncStateChanged/);
  assert.match(provider, /requestWorkspaceRefresh/);
  assert.match(config, /useCloudLibraryLiveSnapshot/);
  assert.match(config, /updateLanguageLibrary\(next\)/);
  assert.doesNotMatch(config, /setInterval/);
  assert.doesNotMatch(config, /\/api\/admin\/cloud-fetch\/libraries/);
});

test("cloud source log item is shared by admin and user cloud source lists", () => {
  const shared = source("src/components/CloudSourceLogItem.tsx");
  const explorer = source("src/components/AdminCloudLibraryExplorer.tsx");
  const userTabs = source("src/components/SourceSyncLogTabs.tsx");

  assert.match(shared, /export function CloudSourceLogItem/);
  assert.match(shared, /showSubmitters/);
  assert.match(shared, /Latest cloud fetch log/);
  assert.match(shared, /Recent posts/);
  assert.match(shared, /BuilderFeedItems/);
  assert.match(explorer, /<CloudSourceLogItem/);
  assert.match(explorer, /showSubmitters=\{true\}/);
  assert.match(userTabs, /<CloudSourceLogItem/);
  assert.match(userTabs, /showSubmitters=\{false\}/);
});

test("cloud-library page mounts the library explorer with serialized libraries", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");
  const panel = source("src/components/AdminCloudLibrariesPanel.tsx");
  const data = source("src/lib/cloud-library-overview-data.ts");

  assert.match(page, /AdminCloudLibraryLiveProvider/);
  assert.match(page, /AdminCloudLibrariesPanel/);
  assert.match(panel, /AdminCloudLibraryExplorer/);
  assert.match(panel, /CountMeta/);
  assert.match(data, /serializeCloudLibrary/);
  assert.match(data, /activeSourceTasks/);
  assert.match(data, /submitterCountByBuilder\.get\(task\.builderId\) \?\? 0/);
});
