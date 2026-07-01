import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cloud fetch planning stamps leased task metadata onto normal fetch tasks", async () => {
  const cli = await import("../scripts/builder-digest.mjs");
  const task = cli.buildCloudFetchTaskForTest(
    {
      type: "fetch_post",
      contentStatus: "requires_agent",
      builder: "OpenAI News",
      builderId: "cloud_builder_zh",
      sourceType: "blog",
      builderSync: {
        builderId: "cloud_builder_zh",
        kind: "BLOG",
        sourceType: "blog",
        name: "OpenAI News",
        sourceUrl: "https://openai.com/news/rss.xml",
        fetchUrl: "https://openai.com/news/rss.xml",
      },
      item: {
        kind: "BLOG_POST",
        externalId: "openai-news-1",
        title: "OpenAI News",
        url: "https://openai.com/news/item",
      },
      summaryInstructions: { language: "en", prompt: "Write in English." },
      id: "fetch_post:cloud_builder_zh:BLOG_POST:openai-news-1",
    },
    {
      cloudRunId: "cloud_run_1",
      cloudSourceTaskId: "cloud_task_1",
      summaryLanguage: "zh",
    },
  );

  assert.equal(task.cloudRunId, "cloud_run_1");
  assert.equal(task.cloudSourceTaskId, "cloud_task_1");
  assert.equal(task.summaryLanguage, "zh");
  assert.equal(task.builderSync.cloudSourceTaskId, "cloud_task_1");
  assert.equal(task.builderSync.builderId, "cloud_builder_zh");
  assert.equal(task.summaryInstructions.language, "zh");
  assert.match(task.summaryInstructions.prompt, /Chinese|zh|中文/);
  assert.equal(task.type, "fetch_post");
});

test("cloud fetch command is exposed and keeps worker-facing task shape", async () => {
  const cliSource = await readFile("scripts/builder-digest.mjs", "utf8");

  assert.match(cliSource, /fetch-cloud-library \[--limit 10\]/);
  assert.match(cliSource, /assign-fetch-tasks --tasks fetch-result\.json/);
  assert.match(cliSource, /merge-fetch-results --base fetch-result\.json/);
  assert.match(cliSource, /split-sync-slices --tasks fetch-result\.json[\s\S]*source\|task\|cloud-run/);
  assert.match(cliSource, /heartbeat-cloud-fetch --cloud-run-id <id>/);
  assert.match(cliSource, /else if \(command === "fetch-cloud-library"\) await fetchCloudLibrary\(args\)/);
  assert.match(cliSource, /else if \(command === "assign-fetch-tasks"\) await assignFetchTasks\(args\)/);
  assert.match(cliSource, /else if \(command === "merge-fetch-results"\) await mergeFetchResultsCommand\(args\)/);
  assert.match(cliSource, /else if \(command === "heartbeat-cloud-fetch"\) await heartbeatCloudFetch\(args\)/);
  assert.match(cliSource, /buildFetchTasksForBuilders/);
  assert.match(cliSource, /applySharedPostReuseToFetchTasks/);
  assert.doesNotMatch(cliSource, /user private-library builders are selected by cloud command/);
});

test("cloud library runner reuses the library worker pipeline with cloud fetch and sync commands", async () => {
  const runner = await readFile("scripts/builder-agent-runner.sh", "utf8");

  assert.match(runner, /cloud-library-cron/);
  assert.match(runner, /fetch-cloud-library/);
  assert.match(runner, /sync-cloud-builders/);
  assert.match(runner, /PROMPT_FILE="\$AGENT_DIR\/jobs\/library-worker\.md"/);
  assert.match(runner, /BUILDER_BLOG_CLOUD_FETCH_LIMIT/);
  assert.match(runner, /cloud_fetch_source_limit\(\)/);
  assert.match(runner, /_cloud_fetch_source_limit="\$\(cloud_fetch_source_limit\)"/);
  assert.match(runner, /--limit "\$_cloud_fetch_source_limit"/);
  assert.match(runner, /assign_dynamic_fetch_workers\(\)/);
  assert.match(runner, /assign-fetch-tasks/);
  assert.match(runner, /fetch_more_cloud_sources\(\)/);
  assert.match(runner, /BUILDER_BLOG_CLOUD_REFILL_LIMIT:-100/);
  assert.match(runner, /_crl_value=100/);
  assert.match(runner, /_crl_value" -gt 1000/);
  assert.match(runner, /merge-fetch-results/);
  assert.match(runner, /SYNC_PAYLOAD_SLICE_GRANULARITY="cloud-run"/);
  assert.match(runner, /cloud_fetch_heartbeat_all\(\)/);
  assert.match(runner, /_assigned_fetch_task_ids_file="\$JOB_TMP_DIR\/assigned-fetch-task-ids\.txt"/);
  assert.match(runner, /_active_fetch_group_keys_file="\$JOB_TMP_DIR\/active-fetch-group-keys\.txt"/);
  assert.match(runner, /start_pending_library_workers/);
  assert.match(runner, /cloud_fetch_heartbeat/);
  assert.match(runner, /heartbeat-cloud-fetch --cloud-run-id/);
});

test("cloud copy prompt settings flow into the local cloud runner command", async () => {
  const actions = await readFile("src/components/AdminCloudFetchRunActions.tsx", "utf8");
  const route = await readFile("src/app/api/skill/jobs/[job]/skill.md/route.ts", "utf8");
  const oncePrompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-once.md", "utf8");
  const setupPrompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron-setup.md", "utf8");
  const cronPrompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron.md", "utf8");

  assert.doesNotMatch(actions, /cloud-run-cloud-limit/);
  assert.match(actions, /cloud-run-post-limit/);
  assert.match(actions, /cloud-run-fetch-days/);
  assert.match(actions, /cloud-run-parallel-workers/);
  assert.doesNotMatch(actions, /params\.set\("cloudLimit"/);
  assert.match(actions, /params\.set\("postLimit"/);
  assert.match(actions, /params\.set\("days"/);
  assert.match(actions, /params\.set\("parallel"/);

  assert.doesNotMatch(route, /boundedIntegerParam\(url\.searchParams, "cloudLimit", 10, 1, 100\)/);
  assert.match(route, /boundedIntegerParam\(url\.searchParams, "postLimit", 3, 1, 20\)/);
  assert.doesNotMatch(route, /\{\{CLOUD_FETCH_LIMIT\}\}/);
  assert.match(route, /\{\{FETCH_LIMIT\}\}/);

  for (const prompt of [oncePrompt, setupPrompt, cronPrompt]) {
    assert.doesNotMatch(prompt, /\{\{CLOUD_FETCH_LIMIT\}\}/);
    assert.match(prompt, /\{\{FETCH_LIMIT\}\}/);
    assert.match(prompt, /\{\{FETCH_DAYS\}\}/);
    assert.match(prompt, /\{\{PARALLEL_WORKERS\}\}/);
  }

  for (const prompt of [oncePrompt, setupPrompt]) {
    assert.doesNotMatch(prompt, /BUILDER_BLOG_CLOUD_FETCH_LIMIT/);
    assert.match(prompt, /Check whether a local cloud worker is already running/);
    assert.match(prompt, /ACTIVE_CLOUD_WORKER/);
    assert.match(prompt, /NO_ACTIVE_CLOUD_WORKER/);
    assert.match(prompt, /ask the user whether to replace that active/);
    assert.match(
      prompt,
      /BUILDER_BLOG_FETCH_LIMIT="\$\{BUILDER_BLOG_FETCH_LIMIT-\{\{FETCH_LIMIT\}\}\}"/,
    );
    assert.match(
      prompt,
      /BUILDER_BLOG_FETCH_DAYS="\$\{BUILDER_BLOG_FETCH_DAYS-\{\{FETCH_DAYS\}\}\}"/,
    );
    assert.match(
      prompt,
      /BUILDER_BLOG_PARALLEL_WORKERS="\$\{BUILDER_BLOG_PARALLEL_WORKERS-\{\{PARALLEL_WORKERS\}\}\}"/,
    );
  }

  assert.doesNotMatch(setupPrompt, /CLOUD_LIMIT=/);
  assert.match(setupPrompt, /POST_LIMIT="\$\{BUILDER_BLOG_FETCH_LIMIT-\{\{FETCH_LIMIT\}\}\}"/);
  assert.match(setupPrompt, /FETCH_DAYS="\$\{BUILDER_BLOG_FETCH_DAYS-\{\{FETCH_DAYS\}\}\}"/);
  assert.match(setupPrompt, /WORKERS="\$\{BUILDER_BLOG_PARALLEL_WORKERS-\{\{PARALLEL_WORKERS\}\}\}"/);
  assert.match(
    setupPrompt,
    /BUILDER_BLOG_FETCH_LIMIT="\$POST_LIMIT" BUILDER_BLOG_FETCH_DAYS="\$FETCH_DAYS" BUILDER_BLOG_PARALLEL_WORKERS="\$WORKERS"/,
  );
});

test("cloud source readiness check is read-only and verifies deployment prerequisites", async () => {
  const script = await readFile("scripts/check-cloud-source-fetch-readiness.mts", "utf8");
  const prompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron.md", "utf8");

  assert.match(script, /000080_cloud_source_fetch/);
  assert.match(script, /CloudFetchQueueItem_active_task_key/);
  assert.match(script, /cloudLanguageLibrary\.findMany/);
  assert.match(script, /adminEmails/);
  assert.match(prompt, /check-cloud-source-fetch-readiness\.mts --language zh/);
  assert.match(prompt, /It must report `ready`/);
  assert.doesNotMatch(script, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  assert.doesNotMatch(script, /\$executeRaw/);
});

test("cloud rollback smoke exercises the DB flow inside one rolled-back transaction", async () => {
  const script = await readFile("scripts/smoke-cloud-source-fetch-rollback.mts", "utf8");
  const prompt = await readFile("skills/builder-blog-digest/jobs/cloud-library-cron.md", "utf8");

  assert.match(script, /prisma\.\$transaction/);
  assert.match(script, /throw new SmokeRollback\(\)/);
  assert.match(script, /submitUserPrivateLibraryToCloud/);
  assert.match(script, /leaseCloudFetchTasks/);
  assert.match(script, /syncBuilderFeedItems/);
  assert.match(script, /applyCloudFetchTaskSyncResult/);
  assert.match(script, /upsertSourceCandidateFromCloudBuilder/);
  assert.match(script, /remainingUsers/);
  assert.match(prompt, /smoke-cloud-source-fetch-rollback\.mts --language zh/);
});
