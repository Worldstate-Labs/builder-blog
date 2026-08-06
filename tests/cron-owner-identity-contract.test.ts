import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function extractHeredoc(text: string, startMarker: string): string {
  const start = text.indexOf(startMarker);
  assert.ok(start >= 0, `Expected to find ${JSON.stringify(startMarker)}`);
  const bodyStart = text.indexOf("\n", start) + 1;
  const end = text.indexOf("\nNODE", bodyStart);
  assert.ok(end > bodyStart, "Expected a closing NODE heredoc delimiter");
  return text.slice(bodyStart, end);
}

function runNodeScript(script: string, args: string[]): { stdout: string; status: number | null } {
  const result = spawnSync("node", ["-", ...args], { input: script, encoding: "utf8" });
  return { stdout: result.stdout, status: result.status };
}

const currentHost = (os.hostname() || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);

for (const { path, job } of [
  { path: "skills/builder-blog-digest/jobs/library-cron-setup.md", job: "library-cron" },
  { path: "skills/builder-blog-digest/jobs/digest-cron-setup.md", job: "digest-cron" },
]) {
  test(`${job} setup regenerates a migrated owner id instead of inheriting another machine's identity`, () => {
    const prompt = source(path);
    assert.ok(
      !prompt.includes('if [ ! -s "$OWNER_FILE" ]'),
      "Setup must not blindly reuse an existing owner file",
    );
    const script = extractHeredoc(prompt, `node - "$ACCOUNT_SLUG" "$OWNER_FILE" <<'NODE'`);
    const dir = mkdtempSync(join(tmpdir(), "cron-owner-"));
    const ownerFile = join(dir, `cron-owner-${job}-slug_1234abcd`);

    // Migrated file: minted on another machine, same account+job.
    const staleId = `local:OtherMac.local:slug_1234abcd:${job}:11111111-1111-4111-8111-111111111111`;
    writeFileSync(ownerFile, `${staleId}\n`);
    let run = runNodeScript(script, ["slug_1234abcd", ownerFile]);
    assert.equal(run.status, 0);
    const regenerated = readFileSync(ownerFile, "utf8").trim();
    assert.notEqual(regenerated, staleId);
    assert.match(regenerated, new RegExp(`^local:${currentHost.replace(/[.]/g, "[.]")}:slug_1234abcd:${job}:[0-9a-f-]{36}$`));

    // Locally minted file: reused unchanged.
    run = runNodeScript(script, ["slug_1234abcd", ownerFile]);
    assert.equal(run.status, 0);
    assert.equal(readFileSync(ownerFile, "utf8").trim(), regenerated);

    // Wrong account slug: regenerated.
    run = runNodeScript(script, ["other_slug_5678efgh", join(dir, "owner-other")]);
    assert.equal(run.status, 0);
    const created = readFileSync(join(dir, "owner-other"), "utf8").trim();
    assert.match(created, new RegExp(`^local:.*:other_slug_5678efgh:${job}:`));
  });
}

test("library runner exits 65 when durably recorded post failures survive a clean sync", () => {
  const runner = source("scripts/builder-agent-runner.sh");
  const flushIndex = runner.indexOf(
    'if ! flush_remaining_library_results "$_result_file" "$_results_dir" "$_checkpoint_synced_ids_file" "$_shard_timeout" "library-result"',
  );
  assert.ok(flushIndex >= 0);
  const tail = runner.slice(flushIndex);
  const guardIndex = tail.indexOf('[ "$_sync_command" != "sync-cloud-builders" ]');
  assert.ok(guardIndex >= 0, "Failed-outcome gate must be scoped to the personal library flow");
  const gate = tail.slice(guardIndex);
  assert.ok(gate.includes("durably recorded failed post task"), "Gate must report failed post tasks");
  assert.ok(gate.includes("return 65"), "Gate must exit 65 so the setup verdict can classify needs_confirmation");
});

test("library runner failed-outcome counter counts only failed and blocked outcomes", () => {
  const runner = source("scripts/builder-agent-runner.sh");
  const script = extractHeredoc(runner, `_library_failed_outcomes="$(node - "$JOB_TMP_DIR/library-agent-sync.json" <<'NODE'`);
  const dir = mkdtempSync(join(tmpdir(), "library-sync-"));

  const mixed = join(dir, "mixed.json");
  writeFileSync(mixed, JSON.stringify({
    taskOutcomes: [
      { fetchTaskId: "a", status: "failed", reason: "primary_content_unavailable" },
      { fetchTaskId: "b", status: "blocked", reason: "paywalled" },
      { fetchTaskId: "c", status: "synced" },
      { fetchTaskId: "d", status: "skipped", reason: "already_fetched" },
      { fetchTaskId: "e", status: "action_needed", reason: "x_token_missing" },
    ],
  }));
  assert.equal(runNodeScript(script, [mixed]).stdout.trim(), "2");

  const clean = join(dir, "clean.json");
  writeFileSync(clean, JSON.stringify({ taskOutcomes: [{ fetchTaskId: "c", status: "synced" }] }));
  assert.equal(runNodeScript(script, [clean]).stdout.trim(), "0");

  // Malformed evidence must not crash the runner; it counts zero and the
  // verdict classifier stays the authority on fatal evidence problems.
  assert.equal(runNodeScript(script, [join(dir, "missing.json")]).stdout.trim(), "0");
});
