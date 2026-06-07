import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DigestContent } from "../src/components/DigestContent";
import { PostCard } from "../src/components/PostCard";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("recommendation feed persists snapshots and marks reads without removing cards", () => {
  const schema = source("prisma/schema.prisma");
  const apiRoute = source("src/app/api/recommendations/route.ts");
  const feed = source("src/components/RecommendationFeed.tsx");
  const postCard = source("src/components/PostCard.tsx");
  const postDetailPage = source("src/components/PostDetailPage.tsx");
  const legacyDetailPage = source("src/app/(workspace)/recommendations/items/[feedItemId]/page.tsx");

  assert.match(schema, /model RecommendationSnapshot/);
  assert.match(schema, /model RecommendationSnapshotItem/);
  assert.match(apiRoute, /readAt: read\.readAt\.toISOString\(\)/);
  assert.match(feed, /initialSnapshots/);
  assert.match(feed, /PostCard/);
  assert.match(feed, /onInteract/);
  assert.match(feed, /showAdminActions = false/);
  assert.match(feed, /showDebugActions=\{showAdminActions\}/);
  assert.match(feed, /reasons=\{showAdminActions \? entry\.reasons : undefined\}/);
  assert.match(feed, /showSourceBadge=\{false\}/);
  assert.match(feed, /stackActionsOnMobile=\{showAdminActions\}/);
  assert.match(postCard, /data-read/);
  assert.match(postCard, /data-stack-actions/);
  assert.match(postCard, /Raw content/);
  assert.match(postCard, /showRawContent = true/);
  assert.doesNotMatch(feed, /mode = "following"|isFavoritesTab/);
  assert.match(feed, /onInteract=\{\(\) => markRead\(entry\.item\.id\)\}/);
  assert.match(postCard, /SourceAvatar/);
  assert.match(postCard, /className="post-meta-author"/);
  assert.match(postCard, /className="post-meta-avatar"/);
  assert.match(postCard, /post-meta-author-link[\s\S]*onClick=\{noteInteraction\}/);
  assert.match(postCard, /className="post-actions"[\s\S]*onClickCapture=\{noteInteraction\}/);
  assert.match(postDetailPage, /ChevronLeft/);
  assert.match(postDetailPage, /Following/);
  assert.doesNotMatch(postDetailPage, /Back to feed/);
  assert.match(postDetailPage, /href=\{backLink\.href\}/);
  assert.match(postDetailPage, /href:\s*"\/dashboard\?tab=following"/);
  assert.match(postDetailPage, /returnLabel/);
  assert.match(postDetailPage, /returnTo/);
  assert.match(postDetailPage, /isSafeInternalReturnTo/);
  assert.match(postDetailPage, /feedRead\.create/);
  assert.match(postDetailPage, /avatarUrl:\s*item\.builder\.avatarUrl/);
  assert.match(postDetailPage, /item\.body/);
  assert.match(legacyDetailPage, /redirect\(`\/posts\/\$\{feedItemId\}\$\{suffix\}`\)/);
  assert.doesNotMatch(feed, /filter\(\(entry\) => entry\.item\.id !== feedItemId\)/);
});

test("favorites saves posts without reintroducing a separate saved feed", () => {
  const schema = source("prisma/schema.prisma");
  const favoriteRoute = source("src/app/api/favorites/route.ts");
  const digestRoute = source("src/app/api/digests/[digestId]/route.ts");
  const digestDetails = source("src/components/DigestDetails.tsx");
  const digestContent = source("src/components/DigestContent.tsx");
  const feed = source("src/components/RecommendationFeed.tsx");
  const postCard = source("src/components/PostCard.tsx");
  const globals = source("src/app/globals.css");

  assert.match(schema, /model FeedFavorite/);
  assert.match(schema, /@@unique\(\[userId, entityId, kind, externalId\]\)/);
  assert.match(favoriteRoute, /favoritePost/);
  assert.match(favoriteRoute, /unfavoritePost/);
  assert.doesNotMatch(favoriteRoute, /export async function GET/);
  assert.match(feed, /FavoriteToggleButton/);
  assert.match(feed, /Save/);
  assert.match(feed, /title=\{isFavorite \? "Saved post" : "Save post"\}/);
  assert.match(digestRoute, /favoriteStateByUrl/);
  assert.match(digestRoute, /activePoolBuilderIds/);
  assert.match(digestRoute, /feedFavorite\.findMany/);
  assert.match(digestDetails, /favoriteStateByUrl/);
  assert.match(digestDetails, /cleanFavoriteStateByUrl/);
  assert.match(digestDetails, /fetch\("\/api\/favorites"/);
  assert.match(digestContent, /DigestFavoriteToggleButton/);
  assert.match(digestContent, /onFavoriteToggle/);
  assert.match(digestContent, /post-favorite-btn/);
  assert.doesNotMatch(feed, /Saved to Favorites|Save to Favorites/);
  assert.doesNotMatch(digestContent, /Saved to Favorites|Save to Favorites/);
  assert.doesNotMatch(feed, /disabled=\{isRead\}/);
  assert.doesNotMatch(feed, /mode\?: "favorites"|FavoriteReadButton|markedReadAt|\/api\/favorites\/read/);
  assert.doesNotMatch(postCard, /data-favorite-read|favoriteReadEmphasis/);
  assert.doesNotMatch(globals, /data-favorite-read="true"|favorite-read-label|favorite-mark-read/);
  assert.doesNotMatch(globals, /inset 4px 0 0/);
  assert.doesNotMatch(globals, /linear-gradient\(\s*90deg/);
});

test("digest posts can render a save control for their source feed item", () => {
  const html = renderToStaticMarkup(
    createElement(DigestContent, {
      content: `AI Digest - 6/5/2026

## Blog

### anthropic.com

**How we contain Claude across products**

Anthropic explains containment.

Source: https://anthropic.com/engineering/how-we-contain-claude`,
      favoriteStateByUrl: {
        "https://anthropic.com/engineering/how-we-contain-claude": {
          feedItemId: "feed_123",
          favoritedAt: null,
        },
      },
      onFavoriteToggle: () => undefined,
      sourceLinks: [
        {
          aliases: ["anthropic.com"],
          entityId: "entity_anthropic",
          href: "/builder/entity_anthropic",
          name: "anthropic.com",
          sourceType: "blog",
          sourceUrl: "https://anthropic.com/engineering",
        },
      ],
    }),
  );

  assert.match(html, /post-favorite-btn/);
  assert.doesNotMatch(html, />Save</);
  assert.doesNotMatch(html, />Saved</);
  assert.match(html, /aria-pressed="false"/);
});

test("source logos are shared across recommendation and library surfaces", () => {
  assert.match(source("src/components/SourceBadge.tsx"), /data-source/);
  assert.match(source("src/components/SourceBadge.tsx"), /suppressLabelWhen/);
  assert.match(source("src/components/SourceBadge.tsx"), /labelSuppressedByDuplicate/);
  assert.match(source("src/components/SourceBadge.tsx"), /decorative = false/);
  assert.match(source("src/components/SourceBadge.tsx"), /aria-label=\{!decorative && !shouldShowLabel && !labelSuppressedByDuplicate \? source\.label : undefined\}/);
  assert.match(source("src/components/SourceBadge.tsx"), /sameDisplayLabel\(source\.label, suppressLabelWhen\)/);
  assert.match(source("src/components/PostCard.tsx"), /SourceBadge/);
  assert.match(source("src/components/PostCard.tsx"), /SourceAvatar/);
  assert.match(source("src/components/PostCard.tsx"), /suppressLabelWhen=\{authorName\}/);
  assert.match(source("src/components/PostCard.tsx"), /const canReadRawContent = !isDetail && showRawContent && Boolean\(rawContent\)/);
  assert.match(source("src/components/PostCard.tsx"), /export function PostCard/);
  assert.match(source("src/components/FetchedPostCard.tsx"), /PostCard as FetchedPostCard/);
  assert.match(source("src/components/RecommendationFeed.tsx"), /PostCard/);
  assert.match(source("src/components/RecentPostsList.tsx"), /PostCard/);
  assert.doesNotMatch(source("src/components/RecentPostsList.tsx"), /variant="row"/);
  assert.doesNotMatch(source("src/components/RecentPostsList.tsx"), /showBuilderRow=\{false\}/);
  assert.match(source("src/components/PostCard.tsx"), /showDebugActions = false/);
  assert.match(source("src/components/BuilderFeedItems.tsx"), /PostCard/);
  assert.match(source("src/components/BuilderLibraryList.tsx"), /SourceBadge/);
  assert.match(source("src/components/LibraryHubImportForm.tsx"), /SourceBadge/);
  assert.match(source("src/components/FeedCard.tsx"), /PostCard/);
});

test("post card suppresses duplicate source labels across meta and footer actions", () => {
  const html = renderToStaticMarkup(
    createElement(PostCard, {
      post: {
        id: "feed_product_hunt",
        title: "#3 MAI-Image-2.5",
        body: "Product Hunt summary.",
        url: "https://www.producthunt.com/products/mai-image-2-5",
        publishedAt: "2026-06-05T00:00:00.000Z",
        createdAt: "2026-06-06T00:00:00.000Z",
        sourceName: "Product Hunt Top Products",
        fetchTool: null,
        builder: {
          id: "builder_product_hunt",
          entityId: "entity_product_hunt",
          name: "Product Hunt Top Products",
          kind: "WEBSITE",
          sourceType: "product_hunt_top_products",
          sourceUrl: "https://www.producthunt.com/",
          fetchUrl: "https://www.producthunt.com/",
        },
      },
      showDebugActions: false,
    }),
  );

  const visibleText = html.replace(/<[^>]*>/g, "");
  assert.equal((visibleText.match(/Product Hunt Top Products/g) ?? []).length, 1);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /title="Product Hunt Top Products"/);
  assert.match(html, /class="post-source-original"/);
  assert.match(
    html,
    /class="post-source-original"[\s\S]*<span aria-hidden="true" class="source-badge" data-source="product_hunt_top_products" title="Product Hunt Top Products">/,
  );
  assert.doesNotMatch(html, /class="post-source-original"[\s\S]*aria-label="Product Hunt Top Products"/);
  assert.match(html, />View original</);
});

test("post card action controls include the post title in accessible names", () => {
  const longSummary = Array.from({ length: 205 }, (_, index) => `word${index}`).join(" ");
  const html = renderToStaticMarkup(
    createElement(PostCard, {
      post: {
        id: "feed_contextual_actions",
        title: "Contextual Button Labels",
        body: "Fetched raw body.",
        summary: longSummary,
        originalSummary: "Original agent summary.",
        url: "https://example.com/contextual-button-labels",
        publishedAt: "2026-06-05T00:00:00.000Z",
        createdAt: "2026-06-06T00:00:00.000Z",
        sourceName: "Example",
        sourceType: "blog",
        fetchTool: "Codex Desktop (model gpt-5.5) FollowBrief skill fetcher (HTML article)",
      },
    }),
  );

  assert.match(html, /aria-label="View original: Contextual Button Labels"/);
  assert.match(html, /aria-label="Raw content: Contextual Button Labels"/);
  assert.doesNotMatch(html, />Read</);
  assert.doesNotMatch(html, /aria-label="Summary method: Contextual Button Labels"/);
  assert.doesNotMatch(html, /aria-label="View original summary: Contextual Button Labels"/);
  assert.doesNotMatch(html, /aria-label="Show more summary: Contextual Button Labels"/);
  assert.doesNotMatch(html, /post-summary--expandable/);
  assert.doesNotMatch(html, /post-summary-toggle-icon/);
  assert.doesNotMatch(html, />See more</);
  assert.doesNotMatch(html, />See less</);
  assert.match(html, /aria-controls="[^"]+-raw-content"/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /aria-label="Raw content"/);
  assert.doesNotMatch(html, /aria-label="Summary method"/);

  const adminHtml = renderToStaticMarkup(
    createElement(PostCard, {
      post: {
        id: "feed_contextual_admin_actions",
        title: "Contextual Button Labels",
        body: "Fetched raw body.",
        url: "https://example.com/contextual-button-labels",
        publishedAt: "2026-06-05T00:00:00.000Z",
        createdAt: "2026-06-06T00:00:00.000Z",
        sourceName: "Example",
        sourceType: "blog",
        fetchTool: "Codex Desktop (model gpt-5.5) FollowBrief skill fetcher (HTML article)",
      },
      reasons: ["Matches followed source"],
      showDebugActions: true,
    }),
  );
  assert.match(adminHtml, /aria-label="Summary method: Contextual Button Labels"/);
  assert.match(adminHtml, /aria-label="Why recommended"/);
});

test("digest renderer uses source link metadata before section heading fallbacks", () => {
  const html = renderToStaticMarkup(
    createElement(DigestContent, {
      content: `AI Digest - 6/5/2026

## Website

### GitHub Trending

**Repo launch**

Summary.

Source: https://github.com/owner/repo

## Website

### Product Hunt Top Products

**Lightfield**

Summary.

Source: https://www.producthunt.com/products/lightfield`,
      sourceLinks: [
        {
          aliases: ["GitHub Trending"],
          entityId: "entity_github",
          href: "/builder/entity_github",
          name: "GitHub Trending",
          sourceType: "github_trending",
          sourceUrl: "https://github.com/trending?since=daily",
        },
        {
          aliases: ["Product Hunt Top Products"],
          entityId: "entity_ph",
          href: "/builder/entity_ph",
          name: "Product Hunt Top Products",
          sourceType: "product_hunt_top_products",
          sourceUrl: "https://www.producthunt.com/",
        },
      ],
    }),
  );

  assert.match(html, /data-source="github_trending"/);
  assert.match(html, /data-source="product_hunt_top_products"/);
  assert.doesNotMatch(html, /data-source="website"/);
});

test("recommendation snapshots request six posts at a time", () => {
  assert.match(source("src/lib/recommendations.ts"), /defaultRecommendationLimit = 6/);
  assert.match(source("src/app/api/recommendations/timeline/route.ts"), /itemLimit: 6/);
  assert.doesNotMatch(source("src/app/api/recommendations/timeline/route.ts"), /recommendationScope/);
  assert.match(source("src/app/(workspace)/recommendations/page.tsx"), /redirect\("\/dashboard\?tab=following"\)/);
  assert.match(source("src/app/api/recommendations/route.ts"), /limit"\) \?\? "6"/);
  assert.doesNotMatch(source("src/app/api/recommendations/route.ts"), /scope: recommendationScope/);
  const feed = source("src/components/RecommendationFeed.tsx");
  assert.match(feed, /limit=6/);
  assert.match(feed, /Loading posts/);
  assert.doesNotMatch(feed, />\s*Loading\s*</);
});

test("following recommendation feed uses subscribed builders only", () => {
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");
  const tabs = source("src/components/DashboardHomeTabs.tsx");
  const followingSection = source("src/components/FollowingRecommendationSection.tsx");
  const recommendations = source("src/lib/recommendations.ts");

  assert.match(tabs, /AI Digest/);
  assert.match(tabs, /Following/);
  assert.doesNotMatch(tabs, /For You/);
  assert.doesNotMatch(tabs, /Favorites/);
  assert.match(dashboardPage, /aiDigest=/);
  assert.doesNotMatch(dashboardPage, /FavoritePostsSection/);
  assert.match(dashboardPage, /requestedTab === "favorites"[\s\S]*redirect\("\/dashboard"\)/);
  assert.match(dashboardPage, /FollowingRecommendationSection/);
  assert.match(dashboardPage, /sourceReadiness=\{sourceReadiness\}/);
  assert.match(dashboardPage, /dashboardSourceReadinessForUser/);
  assert.doesNotMatch(dashboardPage, /scope="for-you"/);
  assert.match(followingSection, /\/api\/recommendations\/timeline/);
  assert.match(followingSection, /followedSourceCount/);
  assert.match(followingSection, /fetchedPostCount/);
  assert.match(followingSection, /No followed sources yet/);
  assert.match(followingSection, /No posts have been fetched for your followed sources yet/);
  assert.match(followingSection, /No unread posts yet/);
  assert.match(followingSection, /Following can show their latest posts/);
  assert.match(followingSection, /Could not load Following/);
  assert.match(followingSection, /Check your connection, then try again\./);
  assert.doesNotMatch(followingSection, /Something went wrong loading Following|Couldn't load Following/);
  assert.doesNotMatch(followingSection, /Following recommendations can appear|No unread recommendations yet|fetching recommendations/);
  assert.match(followingSection, /FetchSourcesPrompt/);
  assert.match(followingSection, /context="library"/);
  assert.doesNotMatch(followingSection, /scope=\$\{scope\}/);
  assert.doesNotMatch(recommendations, /type RecommendationScope/);
  assert.match(recommendations, /const subscriptionBuilderIds = subscriptions\.map/);
  assert.match(recommendations, /reason: \{ startsWith: "subscription:" \}/);
  assert.match(recommendations, /const seen = new Set<string>\(\)/);
});
