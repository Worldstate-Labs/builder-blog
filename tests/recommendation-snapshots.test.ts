import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("recommendation feed persists snapshots and marks reads without removing cards", () => {
  const schema = source("prisma/schema.prisma");
  const apiRoute = source("src/app/api/recommendations/route.ts");
  const feed = source("src/components/RecommendationFeed.tsx");
  const detailPage = source("src/app/recommendations/items/[feedItemId]/page.tsx");

  assert.match(schema, /model RecommendationSnapshot/);
  assert.match(schema, /model RecommendationSnapshotItem/);
  assert.match(apiRoute, /readAt: read\.readAt\.toISOString\(\)/);
  assert.match(feed, /initialSnapshots/);
  assert.match(feed, /data-read/);
  assert.match(feed, /recommendations\/items/);
  assert.match(feed, /"Read"/);
  assert.doesNotMatch(feed, /Mark read/);
  assert.match(detailPage, /Back to feed/);
  assert.match(detailPage, /feedRead\.upsert/);
  assert.match(detailPage, /item\.body/);
  assert.doesNotMatch(feed, /filter\(\(entry\) => entry\.item\.id !== feedItemId\)/);
});

test("source logos are shared across recommendation and library surfaces", () => {
  assert.match(source("src/components/SourceBadge.tsx"), /data-source/);
  assert.match(source("src/components/RecommendationFeed.tsx"), /SourceBadge/);
  assert.match(source("src/app/builders/page.tsx"), /SourceBadge/);
  assert.match(source("src/app/library-hub/page.tsx"), /SourceBadge/);
  assert.match(source("src/components/FeedCard.tsx"), /SourceBadge/);
});

test("recommendation snapshots request six posts at a time", () => {
  assert.match(source("src/lib/recommendations.ts"), /defaultRecommendationLimit = 6/);
  assert.match(source("src/app/recommendations/page.tsx"), /itemLimit: 6/);
  assert.match(source("src/app/api/recommendations/route.ts"), /limit"\) \?\? "6"/);
  assert.match(source("src/components/RecommendationFeed.tsx"), /limit=6/);
});
