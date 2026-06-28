import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("admin cloud fetch runs route is admin-gated and serializes cloud runs", () => {
  const route = source("src/app/api/admin/cloud-fetch/runs/route.ts");

  assert.match(route, /export async function GET/);
  assert.match(route, /requireCloudFetchAdmin\(request\)/);
  assert.match(route, /NextResponse\.json\(\{ error: auth\.error \}/);
  assert.match(route, /cloudFetchRun\.findMany/);
  assert.match(route, /serializeCloudFetchRun/);
  assert.match(route, /builder: \{ select: \{ name: true, sourceType: true \} \}/);
});

test("cloud-library management page is admin-gated and mounts both Phase 1 sections", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");

  assert.match(page, /isAdminEmail/);
  assert.match(page, /redirect\(/);
  assert.match(page, /AdminCloudFetchRunActions/);
  assert.match(page, /AdminCloudFetchLog/);
});

test("settings page links to the cloud library management route for admins", () => {
  const page = source("src/app/(workspace)/settings/page.tsx");

  assert.match(page, /\/settings\/cloud-library/);
});

test("copy-prompt jobs for cloud run-once and recurring setup are whitelisted", () => {
  const jobs = source("src/lib/skill-job-files.ts");

  assert.match(jobs, /"cloud-library-once":/);
  assert.match(jobs, /"cloud-library-cron-setup":/);
});

test("cloud run actions component copies prompts for both cloud jobs via exchange codes", () => {
  const actions = source("src/components/AdminCloudFetchRunActions.tsx");

  assert.match(actions, /cloud-library-once/);
  assert.match(actions, /cloud-library-cron-setup/);
  assert.match(actions, /exchange-code/);
  assert.match(actions, /\/api\/skill\/jobs\//);
});

test("cloud fetch log component reads the admin runs endpoint", () => {
  const log = source("src/components/AdminCloudFetchLog.tsx");

  assert.match(log, /\/api\/admin\/cloud-fetch\/runs/);
  assert.match(log, /tasksClaimed/);
});

test("admin cloud source drill-down route is admin-gated and returns submitters and posts", () => {
  const route = source("src/app/api/admin/cloud-fetch/sources/[builderId]/route.ts");

  assert.match(route, /export async function GET/);
  assert.match(route, /requireCloudFetchAdmin\(request\)/);
  assert.match(route, /cloudSourceSubmission\.findMany/);
  assert.match(route, /feedItem\.findMany/);
  assert.match(route, /serializeCloudSourceSubmitter/);
  assert.match(route, /serializeCloudSourcePost/);
});

test("cloud library explorer lists libraries and lazy-loads source drill-downs", () => {
  const explorer = source("src/components/AdminCloudLibraryExplorer.tsx");

  assert.match(explorer, /submitterCount/);
  assert.match(explorer, /postCount/);
  assert.match(explorer, /\/api\/admin\/cloud-fetch\/sources\//);
});

test("cloud-library page mounts the library explorer with serialized libraries", () => {
  const page = source("src/app/(workspace)/settings/cloud-library/page.tsx");

  assert.match(page, /AdminCloudLibraryExplorer/);
  assert.match(page, /serializeCloudLibrary/);
});
