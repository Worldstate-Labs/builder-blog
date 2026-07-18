import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as contentSyncEvents from "../src/lib/content-sync-events";

type LogMarkerModule = {
  logRecordKeys?: (keys: string[]) => string[];
  hasUnseenLogRecords?: (current: string[], seen: string[]) => boolean;
};

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("log record sets detect every new id without treating updates or removals as unread", () => {
  const {
    logRecordKeys,
    hasUnseenLogRecords,
  } = contentSyncEvents as LogMarkerModule;

  assert.equal(typeof logRecordKeys, "function");
  assert.equal(typeof hasUnseenLogRecords, "function");
  if (!logRecordKeys || !hasUnseenLogRecords) return;

  const seen = logRecordKeys(["local:newer", "local:newer", ""]);
  assert.deepEqual(seen, ["local:newer"]);
  assert.equal(hasUnseenLogRecords(["local:newer"], seen), false);
  assert.equal(hasUnseenLogRecords([], seen), false);
  assert.equal(hasUnseenLogRecords(["local:newer", "local:late-older"], seen), true);
});

test("source log tabs persist independent read markers and render accessible unread dots", () => {
  const tabs = source("src/components/SourceSyncLogTabs.tsx");
  const panel = source("src/components/FetchLogPanel.tsx");
  const styles = source("src/app/globals.css");

  assert.match(tabs, /source-log-read-markers:/);
  assert.match(tabs, /hasUnseenLogRecords/);
  assert.match(tabs, /source-sync-log-unread-dot/);
  assert.match(tabs, />New logs<\/span>/);
  assert.match(tabs, /hidden=\{selected !== "cloud"\}/);
  assert.match(tabs, /hidden=\{selected !== "local"\}/);
  assert.match(tabs, /onLogRecordKeysChange=/);
  assert.match(panel, /onLogRecordKeysChange/);
  assert.match(styles, /\.source-sync-log-unread-dot\s*\{/);
  assert.match(styles, /background:\s*var\(--danger\)/);
});
