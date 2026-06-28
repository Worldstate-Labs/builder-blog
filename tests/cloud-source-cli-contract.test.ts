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
  assert.match(cliSource, /heartbeat-cloud-fetch --cloud-run-id <id>/);
  assert.match(cliSource, /else if \(command === "fetch-cloud-library"\) await fetchCloudLibrary\(args\)/);
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
  assert.match(runner, /cloud_fetch_heartbeat/);
  assert.match(runner, /heartbeat-cloud-fetch --cloud-run-id/);
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
