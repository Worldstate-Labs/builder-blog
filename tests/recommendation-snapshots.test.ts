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
  const crawledPostCard = source("src/components/CrawledPostCard.tsx");
  const detailPage = source("src/app/(workspace)/recommendations/items/[feedItemId]/page.tsx");

  assert.match(schema, /model RecommendationSnapshot/);
  assert.match(schema, /model RecommendationSnapshotItem/);
  assert.match(apiRoute, /readAt: read\.readAt\.toISOString\(\)/);
  assert.match(feed, /initialSnapshots/);
  assert.match(feed, /CrawledPostCard/);
  assert.match(feed, /onInteract/);
  assert.match(crawledPostCard, /data-read/);
  assert.match(crawledPostCard, /Raw crawled content/);
  assert.doesNotMatch(feed, /Mark read/);
  assert.match(detailPage, /Back to feed/);
  assert.match(detailPage, /feedRead\.create/);
  assert.match(detailPage, /item\.body/);
  assert.doesNotMatch(feed, /filter\(\(entry\) => entry\.item\.id !== feedItemId\)/);
});

test("source logos are shared across recommendation and library surfaces", () => {
  assert.match(source("src/components/SourceBadge.tsx"), /data-source/);
  assert.match(source("src/components/CrawledPostCard.tsx"), /SourceBadge/);
  assert.match(source("src/components/RecommendationFeed.tsx"), /CrawledPostCard/);
  assert.match(source("src/components/BuilderFeedItems.tsx"), /CrawledPostCard/);
  assert.match(source("src/components/BuilderLibraryList.tsx"), /SourceBadge/);
  assert.match(source("src/components/LibraryHubImportForm.tsx"), /kindLabel/);
  assert.match(source("src/components/FeedCard.tsx"), /CrawledPostCard/);
});

test("recommendation snapshots request six posts at a time", () => {
  assert.match(source("src/lib/recommendations.ts"), /defaultRecommendationLimit = 6/);
  assert.match(source("src/app/api/recommendations/timeline/route.ts"), /itemLimit: 6/);
  assert.match(source("src/app/api/recommendations/timeline/route.ts"), /recommendationScope/);
  assert.match(source("src/app/(workspace)/recommendations/page.tsx"), /redirect\("\/dashboard\?tab=for-you"\)/);
  assert.match(source("src/app/api/recommendations/route.ts"), /limit"\) \?\? "6"/);
  assert.match(source("src/app/api/recommendations/route.ts"), /scope: recommendationScope/);
  assert.match(source("src/components/RecommendationFeed.tsx"), /limit=6/);
});

test("subscription recommendation feed uses subscribed builders only", () => {
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");
  const tabs = source("src/components/DashboardHomeTabs.tsx");
  const forYouSection = source("src/components/ForYouRecommendationSection.tsx");
  const recommendations = source("src/lib/recommendations.ts");

  assert.match(tabs, /AI digest/);
  assert.match(tabs, /Subscription/);
  assert.match(tabs, /For You/);
  assert.match(dashboardPage, /aiDigest=/);
  assert.match(dashboardPage, /scope="subscription"/);
  assert.match(dashboardPage, /scope="for-you"/);
  assert.match(forYouSection, /scope=\$\{scope\}/);
  assert.match(recommendations, /type RecommendationScope = "for-you" \| "subscription"/);
  assert.match(recommendations, /scope === "subscription"[\s\S]*subscriptionBuilderIds/);
  assert.match(recommendations, /reason: \{ startsWith: "subscription:" \}/);
});
