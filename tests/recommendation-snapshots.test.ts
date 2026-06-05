import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DigestContent } from "../src/components/DigestContent";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("recommendation feed persists snapshots and marks reads without removing cards", () => {
  const schema = source("prisma/schema.prisma");
  const apiRoute = source("src/app/api/recommendations/route.ts");
  const feed = source("src/components/RecommendationFeed.tsx");
  const postCard = source("src/components/PostCard.tsx");
  const detailPage = source("src/app/(workspace)/recommendations/items/[feedItemId]/page.tsx");

  assert.match(schema, /model RecommendationSnapshot/);
  assert.match(schema, /model RecommendationSnapshotItem/);
  assert.match(apiRoute, /readAt: read\.readAt\.toISOString\(\)/);
  assert.match(feed, /initialSnapshots/);
  assert.match(feed, /PostCard/);
  assert.match(feed, /onInteract/);
  assert.match(feed, /showAdminActions = false/);
  assert.match(feed, /showDebugActions=\{showAdminActions\}/);
  assert.match(feed, /reasons=\{showAdminActions \? entry\.reasons : undefined\}/);
  assert.match(feed, /stackActionsOnMobile=\{showAdminActions\}/);
  assert.match(postCard, /data-read/);
  assert.match(postCard, /data-stack-actions/);
  assert.match(postCard, /Raw content/);
  assert.match(feed, /mode = "following"/);
  assert.match(feed, /onInteract=\{isFavoritesTab \? undefined : \(\) => markRead\(entry\.item\.id\)\}/);
  assert.match(postCard, /post-meta-author-link[\s\S]*onClick=\{noteInteraction\}/);
  assert.match(postCard, /className="post-actions"[\s\S]*onClickCapture=\{noteInteraction\}/);
  assert.match(detailPage, /ChevronLeft/);
  assert.match(detailPage, /Following/);
  assert.doesNotMatch(detailPage, /Back to feed/);
  assert.match(detailPage, /href="\/dashboard\?tab=subscription"/);
  assert.match(detailPage, /feedRead\.create/);
  assert.match(detailPage, /item\.body/);
  assert.doesNotMatch(feed, /filter\(\(entry\) => entry\.item\.id !== feedItemId\)/);
});

test("home favorites saves posts and requires manual read marking", () => {
  const schema = source("prisma/schema.prisma");
  const favoriteRoute = source("src/app/api/favorites/route.ts");
  const favoriteReadRoute = source("src/app/api/favorites/read/route.ts");
  const favoriteSection = source("src/components/FavoritePostsSection.tsx");
  const feed = source("src/components/RecommendationFeed.tsx");
  const postCard = source("src/components/PostCard.tsx");
  const globals = source("src/app/globals.css");

  assert.match(schema, /model FeedFavorite/);
  assert.match(schema, /@@unique\(\[userId, entityId, kind, externalId\]\)/);
  assert.match(schema, /markedReadAt\s+DateTime\?/);
  assert.match(favoriteRoute, /GET/);
  assert.match(favoriteRoute, /favoritePost/);
  assert.match(favoriteRoute, /unfavoritePost/);
  assert.match(favoriteReadRoute, /markedRead/);
  assert.match(favoriteReadRoute, /setFavoriteMarkedRead/);
  assert.doesNotMatch(favoriteReadRoute, /markFavoriteRead/);
  assert.match(favoriteSection, /\/api\/favorites/);
  assert.match(favoriteSection, /mode="favorites"/);
  assert.match(feed, /FavoriteToggleButton/);
  assert.match(feed, /Save/);
  assert.match(feed, /FavoriteReadButton/);
  assert.match(feed, /Mark read/);
  assert.match(feed, /Unmark read/);
  assert.match(feed, /\/api\/favorites\/read/);
  assert.match(feed, /markedReadAt/);
  assert.match(feed, /isMarkedRead/);
  assert.match(feed, /dataRead=\{isFavoritesTab \? false : isRead\}/);
  assert.match(feed, />Marked read</);
  assert.doesNotMatch(feed, /Manually marked read/);
  assert.doesNotMatch(feed, /disabled=\{isRead\}/);
  assert.match(feed, /isFavoritesTab \? undefined/);
  assert.match(postCard, /data-favorite-read/);
  assert.match(globals, /data-favorite-read="true"/);
  assert.match(globals, /favorite-read-label/);
  assert.doesNotMatch(globals, /inset 4px 0 0/);
  assert.doesNotMatch(globals, /linear-gradient\(\s*90deg/);
});

test("source logos are shared across recommendation and library surfaces", () => {
  assert.match(source("src/components/SourceBadge.tsx"), /data-source/);
  assert.match(source("src/components/PostCard.tsx"), /SourceBadge/);
  assert.match(source("src/components/PostCard.tsx"), /export function PostCard/);
  assert.match(source("src/components/FetchedPostCard.tsx"), /PostCard as FetchedPostCard/);
  assert.match(source("src/components/RecommendationFeed.tsx"), /PostCard/);
  assert.match(source("src/components/RecentPostsList.tsx"), /PostCard/);
  assert.doesNotMatch(source("src/components/RecentPostsList.tsx"), /variant="row"/);
  assert.doesNotMatch(source("src/components/RecentPostsList.tsx"), /showBuilderRow=\{false\}/);
  assert.doesNotMatch(source("src/components/RecentPostsList.tsx"), /showDebugActions=\{false\}/);
  assert.match(source("src/components/BuilderFeedItems.tsx"), /PostCard/);
  assert.match(source("src/components/BuilderLibraryList.tsx"), /SourceBadge/);
  assert.match(source("src/components/LibraryHubImportForm.tsx"), /kindLabel/);
  assert.match(source("src/components/FeedCard.tsx"), /PostCard/);
});

test("digest renderer preserves GitHub and Product Hunt source badges", () => {
  const html = renderToStaticMarkup(
    createElement(DigestContent, {
      content: `AI Digest - 6/5/2026

## Github Trending

### owner/repo

**Repo launch**

Summary.

Source: https://github.com/owner/repo

## Product Hunt Top Products

### Product Hunt Top Products

**Lightfield**

Summary.

Source: https://www.producthunt.com/products/lightfield`,
      sourceLinks: [],
    }),
  );

  assert.match(html, /data-source="github_trending"/);
  assert.match(html, /data-source="product_hunt_top_products"/);
});

test("recommendation snapshots request six posts at a time", () => {
  assert.match(source("src/lib/recommendations.ts"), /defaultRecommendationLimit = 6/);
  assert.match(source("src/app/api/recommendations/timeline/route.ts"), /itemLimit: 6/);
  assert.doesNotMatch(source("src/app/api/recommendations/timeline/route.ts"), /recommendationScope/);
  assert.match(source("src/app/(workspace)/recommendations/page.tsx"), /redirect\("\/dashboard\?tab=subscription"\)/);
  assert.match(source("src/app/api/recommendations/route.ts"), /limit"\) \?\? "6"/);
  assert.doesNotMatch(source("src/app/api/recommendations/route.ts"), /scope: recommendationScope/);
  assert.match(source("src/components/RecommendationFeed.tsx"), /limit=6/);
});

test("following recommendation feed uses subscribed builders only", () => {
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");
  const tabs = source("src/components/DashboardHomeTabs.tsx");
  const followingSection = source("src/components/FollowingRecommendationSection.tsx");
  const recommendations = source("src/lib/recommendations.ts");

  assert.match(tabs, /Digest/);
  assert.match(tabs, /Favorites/);
  assert.match(tabs, /Following/);
  assert.doesNotMatch(tabs, /For You/);
  assert.match(dashboardPage, /aiDigest=/);
  assert.match(dashboardPage, /FavoritePostsSection/);
  assert.match(dashboardPage, /FollowingRecommendationSection/);
  assert.doesNotMatch(dashboardPage, /scope="for-you"/);
  assert.match(followingSection, /\/api\/recommendations\/timeline/);
  assert.doesNotMatch(followingSection, /scope=\$\{scope\}/);
  assert.doesNotMatch(recommendations, /type RecommendationScope/);
  assert.match(recommendations, /const subscriptionBuilderIds = subscriptions\.map/);
  assert.match(recommendations, /reason: \{ startsWith: "subscription:" \}/);
  assert.match(recommendations, /const seen = new Set<string>\(\)/);
});
