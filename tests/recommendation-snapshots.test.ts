import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DigestContent } from "../src/components/DigestContent";
import { PostCard } from "../src/components/PostCard";
import { digestPostKey, parseDigest } from "../src/lib/digest-markdown";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("recommendation feed persists snapshots and marks reads without removing cards", () => {
  const schema = source("prisma/schema.prisma");
  const apiRoute = source("src/app/api/recommendations/route.ts");
  const feed = source("src/components/RecommendationFeed.tsx");
  const postCard = source("src/components/PostCardView.tsx");
  const postDetailPage = source("src/components/PostDetailPage.tsx");
  const legacyDetailPage = source("src/app/(workspace)/recommendations/items/[feedItemId]/page.tsx");
  const navigation = source("src/lib/navigation.ts");

  assert.match(schema, /model RecommendationSnapshot/);
  assert.match(schema, /model RecommendationSnapshotItem/);
  assert.match(apiRoute, /readAt: read\.readAt\.toISOString\(\)/);
  assert.match(feed, /initialSnapshots/);
  assert.match(feed, /nonEmptySnapshots\(initialSnapshots\)/);
  assert.match(feed, /nonEmptySnapshots\(snapshots\)\.filter/);
  assert.match(feed, /PostCard/);
  assert.match(feed, /onInteract/);
  assert.match(feed, /showAdminActions = false/);
  assert.match(feed, /showDebugActions=\{showAdminActions\}/);
  assert.match(feed, /reasons=\{showAdminActions \? entry\.reasons : undefined\}/);
  assert.doesNotMatch(feed, /showSourceBadge=\{false\}/);
  assert.match(feed, /stackActionsOnMobile=\{showAdminActions\}/);
  assert.match(postCard, /data-read/);
  assert.match(postCard, /data-stack-actions/);
  assert.match(postCard, /Original content/);
  assert.match(postCard, /showRawContent = true/);
  assert.doesNotMatch(feed, /mode = "following"|isFavoritesTab/);
  assert.match(feed, /onInteract=\{\(\) => markRead\(entry\.item\.id\)\}/);
  assert.match(postCard, /SourceAvatar/);
  assert.match(postCard, /className="post-copy"/);
  assert.doesNotMatch(postCard, /className="min-w-0"/);
  assert.match(postCard, /className="post-meta-author"/);
  assert.match(postCard, /className="post-meta-avatar"/);
  assert.match(postCard, /post-meta-author-link[\s\S]*onClick=\{noteInteraction\}/);
  assert.match(postCard, /className="post-actions"[\s\S]*onClickCapture=\{noteInteraction\}/);
  assert.match(postDetailPage, /ChevronLeft/);
  assert.match(postDetailPage, /Following/);
  assert.match(postDetailPage, /Favorites/);
  assert.doesNotMatch(postDetailPage, /Back to feed/);
  assert.match(postDetailPage, /href=\{backLink\.href\}/);
  assert.match(postDetailPage, /href:\s*"\/dashboard\?tab=following"/);
  assert.match(postDetailPage, /returnLabel/);
  assert.match(postDetailPage, /returnTo/);
  assert.match(postDetailPage, /@\/lib\/navigation/);
  assert.match(postDetailPage, /normalizeLegacyReturnTo/);
  assert.doesNotMatch(postDetailPage, /function normalizeLegacyReturnTo/);
  assert.match(navigation, /value\.startsWith\("\/recommendations"\)[\s\S]*"\/dashboard\?tab=following"/);
  assert.match(postDetailPage, /isSafeInternalReturnTo/);
  assert.match(postDetailPage, /returnTo\.includes\("tab=favorites"\)[\s\S]*return "Favorites"/);
  assert.match(postDetailPage, /feedRead\.create/);
  assert.match(postDetailPage, /avatarUrl:\s*item\.builder\.avatarUrl/);
  assert.match(postDetailPage, /item\.body/);
  assert.match(legacyDetailPage, /permanentRedirect\(`\/posts\/\$\{feedItemId\}\$\{suffix\}`\)/);
  assert.match(legacyDetailPage, /returnTo\.startsWith\("\/recommendations"\)/);
  assert.match(legacyDetailPage, /query\.set\("returnTo", "\/dashboard\?tab=following"\)/);
  assert.match(legacyDetailPage, /query\.set\("returnLabel", "Following"\)/);
  assert.doesNotMatch(legacyDetailPage, /For You/);
  assert.doesNotMatch(feed, /filter\(\(entry\) => entry\.item\.id !== feedItemId\)/);
});

test("favorites saves posts into the Favorites tab", () => {
  const schema = source("prisma/schema.prisma");
  const favoriteRoute = source("src/app/api/favorites/route.ts");
  const favoriteSection = source("src/components/FavoritePostsSection.tsx");
  const favoriteList = source("src/components/FavoritePostsList.tsx");
  const favoriteButton = source("src/components/PostFavoriteButton.tsx");
  const postDetailPage = source("src/components/PostDetailPage.tsx");
  const postFavoriteControl = source("src/components/PostFavoriteControl.tsx");
  const feedFavorites = source("src/lib/feed-favorites.ts");
  const searchPage = source("src/app/(workspace)/search/page.tsx");
  const digestRoute = source("src/app/api/digests/[digestId]/route.ts");
  const digestDetails = source("src/components/DigestDetails.tsx");
  const digestContent = source("src/components/DigestContentView.tsx");
  const feed = source("src/components/RecommendationFeed.tsx");
  const postCard = source("src/components/PostCardView.tsx");
  const globals = source("src/app/globals.css");

  assert.match(schema, /model FeedFavorite/);
  assert.match(schema, /@@unique\(\[userId, entityId, kind, externalId\]\)/);
  assert.match(favoriteRoute, /favoritePost/);
  assert.match(favoriteRoute, /unfavoritePost/);
  assert.doesNotMatch(favoriteRoute, /export async function GET/);
  assert.match(favoriteSection, /feedFavorite\.findMany/);
  assert.match(favoriteSection, /orderBy:\s*\{ favoritedAt: "desc" \}/);
  assert.match(favoriteSection, /take:\s*favoritePostLimit/);
  assert.match(favoriteSection, /feedRead\.findMany/);
  assert.match(favoriteList, /aria-label="Favorite posts"/);
  assert.match(favoriteList, /<h2 className="favorites-feed-title">Favorites<\/h2>/);
  assert.match(favoriteList, /Newest saved posts\./);
  assert.doesNotMatch(favoriteList, /Starred posts|Reading queue|Focused reading queue|Posts you starred for focused reading/);
  assert.match(favoriteList, /@\/components\/Count/);
  assert.match(favoriteList, /formatCount\(items\.length\)/);
  assert.match(favoriteList, /Open AI Digest/);
  assert.match(favoriteList, /href="\/dashboard\?tab=ai-digest"/);
  assert.match(favoriteList, /Open Following/);
  assert.match(favoriteList, /href="\/dashboard\?tab=following"/);
  assert.match(favoriteList, /Search posts/);
  assert.match(favoriteList, /href="\/search"/);
  assert.match(favoriteList, /@\/components\/FeedState/);
  assert.match(favoriteList, /<FeedEmptyState/);
  assert.match(favoriteList, /className="favorites-empty is-actionable"/);
  assert.match(favoriteList, /favorites-empty-actions/);
  assert.match(favoriteList, /No Favorites yet/);
  assert.match(favoriteList, /Save posts from AI Digest, Following, Search, or post details\./);
  assert.doesNotMatch(favoriteList, /post pages|AI Digest issues, Following posts|to build this queue|Use the star on any post in AI Digest, Following, Search, or a post detail page to build a focused reading queue here\./);
  assert.doesNotMatch(favoriteList, /Posts you marked for deeper reading/);
  assert.doesNotMatch(favoriteList, /Saved for deeper reading/);
  assert.doesNotMatch(favoriteList, /Star posts from AI Digest|Save posts from AI Digest or Following/);
  assert.match(favoriteList, /postDetailHref\(item\.feedItemId, "\/dashboard\?tab=favorites", "Favorites"\)/);
  assert.match(favoriteList, /PostFavoriteButton/);
  assert.match(favoriteList, /const response = await fetch\("\/api\/favorites"/);
  assert.match(favoriteList, /if \(!response\.ok\) throw new Error\("Favorite update failed"\)/);
  assert.match(favoriteList, /const \[pendingIds, setPendingIds\] = useState<Set<string>>\(\(\) => new Set\(\)\)/);
  assert.match(favoriteList, /disabled=\{pendingIds\.has\(item\.feedItemId\)\}/);
  assert.match(favoriteList, /sortFavoriteItems\(\[\.\.\.current, removedItem\]\)/);
  assert.match(favoriteList, /Could not remove from Favorites\. Try again\./);
  assert.doesNotMatch(favoriteList, /Could not remove from Favorites\. It remains here\./);
  assert.match(favoriteList, /className="favorites-feed-error" role="status"/);
  assert.doesNotMatch(favoriteList, /setItems\(previousItems\)/);
  assert.match(favoriteButton, /const label = postFavoriteActionLabel\(isFavorite\)/);
  assert.match(favoriteButton, /const accessibleLabel = ariaLabel \?\? label/);
  assert.match(favoriteButton, /title=\{accessibleLabel\}/);
  assert.match(favoriteButton, /if \(!target\) return isFavorite \? "Remove from Favorites" : "Save to Favorites"/);
  assert.match(favoriteButton, /`Remove \$\{target\} from Favorites`/);
  assert.match(favoriteButton, /`Save \$\{target\} to Favorites`/);
  assert.match(favoriteButton, /className="post-action-icon"/);
  assert.match(favoriteButton, /disabled=\{disabled\}/);
  assert.match(feed, /PostFavoriteButton/);
  assert.match(feed, /const \[favoriteError, setFavoriteError\] = useState\(""\)/);
  assert.match(feed, /const \[pendingFavoriteIds, setPendingFavoriteIds\] = useState<Set<string>>\(\(\) => new Set\(\)\)/);
  assert.match(feed, /favoriteStateByItemId = useMemo/);
  assert.match(feed, /favoriteStateByItemId\.get\(feedItemId\) \?\? null/);
  assert.match(feed, /restoreFavoriteState\(current, feedItemId, previousFavoritedAt\)/);
  assert.match(feed, /Could not update Favorites\. Try again\./);
  assert.doesNotMatch(feed, /Could not update reading queue|Could not update favorite\. Try again\./);
  assert.match(feed, /className="feed-load-error recommendation-favorite-error" role="status"/);
  assert.match(feed, /disabled=\{pendingFavorite\}/);
  assert.match(feed, /if \(!response\.ok\) throw new Error\("Could not update Favorites\."\)/);
  assert.doesNotMatch(feed, /Best-effort optimistic UI/);
  assert.match(postDetailPage, /PostFavoriteControl/);
  assert.match(postDetailPage, /prisma\.feedFavorite\.findUnique/);
  assert.match(postDetailPage, /canFavoritePost\(session\.user\.id, item\.id\)/);
  assert.match(postDetailPage, /initialIsFavorite=\{Boolean\(favorite\)\}/);
  assert.match(searchPage, /PostFavoriteControl/);
  assert.match(searchPage, /initialIsFavorite=\{Boolean\(result\.favoritedAt\)\}/);
  assert.match(postFavoriteControl, /PostFavoriteButton/);
  assert.match(postFavoriteControl, /fetch\("\/api\/favorites"/);
  assert.match(postFavoriteControl, /method: nextFavorite \? "POST" : "DELETE"/);
  assert.match(postFavoriteControl, /const \[error, setError\] = useState\(""\)/);
  assert.match(postFavoriteControl, /setError\("Could not update Favorites\. Try again\."\)/);
  assert.doesNotMatch(postFavoriteControl, /Could not update reading queue|Could not update favorite\. Try again\./);
  assert.match(postFavoriteControl, /className="post-favorite-status" role="status"/);
  assert.match(postFavoriteControl, /className="post-favorite-control"/);
  assert.match(digestRoute, /favoriteStateByUrl/);
  assert.match(digestRoute, /activePoolBuilderIds/);
  assert.match(digestRoute, /digestId/);
  assert.match(digestRoute, /feedItemId:\s*\{ not: null \}/);
  assert.match(digestRoute, /digestPostEntries\(digest\.content\)/);
  assert.match(digestRoute, /favoriteStateByPostKey/);
  assert.match(digestRoute, /matchDigestPostsToFeedItems/);
  assert.match(digestRoute, /digestPostKey\(section, group, post\)/);
  assert.match(digestRoute, /uniqueFeedItem/);
  assert.match(digestRoute, /feedFavorite\.findMany/);
  assert.match(feedFavorites, /feedItemAppearsInAccessibleDigest/);
  assert.match(feedFavorites, /digestPipelineImport\.findMany/);
  assert.match(feedFavorites, /Post is outside your Sources or AI Digest collections/);
  assert.doesNotMatch(feedFavorites, /Post is not in your sources|imported AI Digest collections|imported AI Digest issues/);
  assert.match(digestDetails, /favoriteStateByUrl/);
  assert.match(digestDetails, /favoriteStateByPostKey/);
  assert.match(digestDetails, /cleanFavoriteStateByUrl/);
  assert.match(digestDetails, /favoriteErrorByUrl: Record<string, string>/);
  assert.match(digestDetails, /pendingFavoriteUrls: Set<string>/);
  assert.match(digestDetails, /pendingFavoriteUrls: new Set<string>\(\)/);
  assert.match(digestDetails, /if \(pendingFavoriteUrls\.has\(url\)\) return/);
  assert.match(digestDetails, /const previousFavoritedAt = favoriteStateByUrl\[url\]\?\.favoritedAt \?\? null/);
  assert.match(digestDetails, /favoriteErrorByUrl: omitUrl\(current\.favoriteErrorByUrl, url\)/);
  assert.match(digestDetails, /favoritedAt: previousFavoritedAt/);
  assert.match(digestDetails, /pendingFavoriteUrls: removeUrl\(current\.pendingFavoriteUrls, url\)/);
  assert.match(digestDetails, /Could not update Favorites\. Try again\./);
  assert.doesNotMatch(digestDetails, /Could not update reading queue|Could not update favorite\. Try again\./);
  assert.match(digestDetails, /function omitUrl/);
  assert.match(digestDetails, /function removeUrl/);
  assert.match(digestDetails, /fetch\("\/api\/favorites"/);
  assert.doesNotMatch(digestDetails, /reload restores truth|Best-effort optimistic UI/);
  assert.match(source("src/components/DigestContentView.tsx"), /PostFavoriteButton/);
  assert.match(digestContent, /onFavoriteToggle/);
  assert.match(digestContent, /digestPostKey/);
  assert.match(digestContent, /favoriteStateByPostKey/);
  assert.match(digestContent, /const EMPTY_PENDING_FAVORITE_URLS = new Set<string>\(\)/);
  assert.match(digestContent, /favoriteErrorByUrl\?: Record<string, string>/);
  assert.match(digestContent, /pendingFavoriteUrls\?: Set<string>/);
  assert.match(digestContent, /disabled=\{pendingFavoriteUrls\.has\(url\)\}/);
  assert.match(digestContent, /className="post-favorite-control"/);
  assert.match(digestContent, /className="post-favorite-status" role="status"/);
  assert.doesNotMatch(feed, /disabled=\{isRead\}/);
  assert.doesNotMatch(feed, /mode\?: "favorites"|FavoriteReadButton|markedReadAt|\/api\/favorites\/read/);
  assert.doesNotMatch(favoriteList, /FavoriteReadButton|markedReadAt|\/api\/favorites\/read/);
  assert.doesNotMatch(postCard, /data-favorite-read|favoriteReadEmphasis/);
  assert.doesNotMatch(globals, /data-favorite-read="true"|favorite-read-label|favorite-mark-read/);
  assert.doesNotMatch(globals, /inset 4px 0 0/);
  assert.doesNotMatch(globals, /linear-gradient\(\s*90deg/);
  assert.match(globals, /\.favorites-empty-actions\s*{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(globals, /\.favorites-empty-actions\s*{[\s\S]*justify-content:\s*flex-start/);
  assert.match(globals, /\.post-favorite-status\s*{[\s\S]*color:\s*var\(--danger\)/);
  assert.match(globals, /\.favorites-feed-error\s*{[\s\S]*color:\s*var\(--danger\)/);
});

test("digest posts can render a save control for their source feed item", () => {
  const content = `AI Digest - 6/5/2026

## Blog

### anthropic.com

**How we contain Claude across products**

Anthropic explains containment.

Source: https://anthropic.com/engineering/how-we-contain-claude`;
  const doc = parseDigest(content);
  const section = doc.sections[0];
  const group = section.groups[0];
  const post = group.posts[0];
  const postKey = digestPostKey(section, group, post);
  const html = renderToStaticMarkup(
    createElement(DigestContent, {
      content,
      favoriteStateByPostKey: {
        [postKey]: {
          feedItemId: "feed_123",
          favoritedAt: null,
        },
      },
      favoriteErrorByUrl: {
        "https://anthropic.com/engineering/how-we-contain-claude":
          "Could not update Favorites. Try again.",
      },
      onFavoriteToggle: () => undefined,
      pendingFavoriteUrls: new Set([
        "https://anthropic.com/engineering/how-we-contain-claude",
      ]),
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
  assert.match(html, /disabled=""/);
  assert.match(html, /post-favorite-status/);
  assert.match(html, /Could not update Favorites\. Try again\./);
});

test("source logos are shared across recommendation and library surfaces", () => {
  assert.match(source("src/components/SourceBadge.tsx"), /data-source/);
  assert.match(source("src/components/SourceBadge.tsx"), /className="source-badge-icon"/);
  assert.match(source("src/components/SourceBadge.tsx"), /sourceIcons/);
  assert.doesNotMatch(source("src/components/SourceBadge.tsx"), /h-3\.5 w-3\.5|h-4 w-4/);
  assert.match(source("src/components/SourceBadge.tsx"), /suppressLabelWhen/);
  assert.match(source("src/components/SourceBadge.tsx"), /labelSuppressedByDuplicate/);
  assert.match(source("src/components/SourceBadge.tsx"), /decorative = false/);
  assert.match(source("src/components/SourceBadge.tsx"), /aria-label=\{!decorative && !shouldShowLabel && !labelSuppressedByDuplicate \? source\.label : undefined\}/);
  assert.match(source("src/components/SourceBadge.tsx"), /sameDisplayLabel\(source\.label, suppressLabelWhen\)/);
  assert.match(source("src/components/PostCardView.tsx"), /SourceBadge/);
  assert.match(source("src/components/PostCardView.tsx"), /SourceAvatar/);
  assert.match(source("src/components/PostCardView.tsx"), /suppressLabelWhen=\{authorName\}/);
  assert.match(source("src/components/PostCardView.tsx"), /const canReadRawContent = !isDetail && showRawContent && Boolean\(rawContent\)/);
  assert.match(source("src/components/PostCard.tsx"), /export function PostCard/);
  assert.match(source("src/components/FetchedPostCard.tsx"), /PostCard as FetchedPostCard/);
  assert.match(source("src/components/RecommendationFeed.tsx"), /PostCard/);
  assert.match(source("src/components/RecentPostsList.tsx"), /PostCard/);
  assert.doesNotMatch(source("src/components/RecentPostsList.tsx"), /variant="row"/);
  assert.doesNotMatch(source("src/components/RecentPostsList.tsx"), /showBuilderRow=\{false\}/);
  assert.match(source("src/components/PostCardView.tsx"), /showDebugActions = false/);
  assert.match(source("src/components/BuilderFeedItems.tsx"), /PostCard/);
  assert.doesNotMatch(source("src/components/BuilderLibraryList.tsx"), /SourceBadge/);
  assert.match(source("src/components/BuilderLibraryList.tsx"), /builder-library-source-list/);
  assert.match(source("src/components/BuilderLibraryList.tsx"), /builder-library-see-more/);
  assert.match(source("src/components/LibraryHubImportForm.tsx"), /SourceBadge/);
  assert.match(source("src/components/FeedCard.tsx"), /PostCard/);
  assert.match(source("src/components/FetchMethodPopover.tsx"), /className="post-action-popover-icon"/);
  assert.match(source("src/components/RecommendationReasonsPopover.tsx"), /className="post-action-popover-icon"/);
  assert.doesNotMatch(source("src/components/FetchMethodPopover.tsx"), /h-4 w-4|h-3\.5 w-3\.5/);
  assert.doesNotMatch(source("src/components/RecommendationReasonsPopover.tsx"), /h-4 w-4|h-3\.5 w-3\.5/);
  assert.match(source("src/app/globals.css"), /\.post-action-popover-icon\s*{[\s\S]*height:\s*1rem/);
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
  const metaHtml = html.match(/<div class="post-meta">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.equal((visibleText.match(/Product Hunt Top Products/g) ?? []).length, 1);
  assert.doesNotMatch(metaHtml, /class="source-badge"/);
  assert.match(html, /class="post-source-original"/);
  assert.match(html, /class="post-source-original"[\s\S]*class="source-badge"/);
  assert.doesNotMatch(html, /class="post-source-original"[\s\S]*aria-label="Product Hunt Top Products"/);
  assert.match(html, />Original</);
});

test("post card keeps the source type badge when there is no original action", () => {
  const html = renderToStaticMarkup(
    createElement(PostCard, {
      post: {
        id: "feed_no_original",
        title: "No original URL",
        body: "Summary only.",
        url: "",
        publishedAt: "2026-06-05T00:00:00.000Z",
        createdAt: "2026-06-06T00:00:00.000Z",
        sourceName: "Example Blog",
        sourceType: "blog",
        fetchTool: null,
      },
      showDebugActions: false,
    }),
  );

  const metaHtml = html.match(/<div class="post-meta">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(metaHtml, /class="source-badge" data-source="blog" title="Blog"/);
  assert.doesNotMatch(html, /class="post-source-original"/);
  assert.doesNotMatch(html, />Original</);
});

test("post detail keeps source actions with the source row without a top source type badge", () => {
  const html = renderToStaticMarkup(
    createElement(PostCard, {
      extraActions: createElement(
        "span",
        { className: "post-favorite-control" },
        createElement("button", { className: "post-favorite-btn", type: "button" }, "Save"),
      ),
      post: {
        id: "feed_detail_mobile_actions",
        title: "Detail Layout",
        body: "Fetched raw body.",
        url: "https://example.com/detail-layout",
        publishedAt: "2026-06-05T00:00:00.000Z",
        createdAt: "2026-06-06T00:00:00.000Z",
        sourceName: "Example Blog",
        sourceType: "blog",
        fetchTool: null,
        builder: {
          id: "builder_blog",
          entityId: "entity_blog",
          name: "Example Blog",
          kind: "BLOG",
          sourceType: "blog",
          sourceUrl: "https://example.com/",
          fetchUrl: "https://example.com/feed.xml",
        },
      },
      showDebugActions: false,
      variant: "detail",
    }),
  );
  const kickerHtml = html.match(/<div class="post-detail-kicker-row"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
  const bylineHtml = html.match(/<div class="post-detail-byline">([\s\S]*?)<\/div><\/header>/)?.[1] ?? "";
  const globals = source("src/app/globals.css");

  assert.doesNotMatch(kickerHtml, /class="source-badge"/);
  assert.match(kickerHtml, /Jun/);
  assert.match(bylineHtml, /post-detail-author/);
  assert.match(bylineHtml, /post-detail-actions/);
  assert.match(bylineHtml, /post-favorite-control[\s\S]*post-source-original/);
  assert.doesNotMatch(globals, /\.post-detail-byline\s*{[\s\S]{0,140}display:\s*grid/);
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

  assert.match(html, /aria-label="Original: Contextual Button Labels"/);
  assert.match(html, /aria-label="Original content: Contextual Button Labels"/);
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
  assert.doesNotMatch(html, /aria-label="Crawled content"/);
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

test("post card keeps source URLs as actions instead of repeated summary text", () => {
  const html = renderToStaticMarkup(
    createElement(PostCard, {
      post: {
        id: "feed_summary_trailing_url",
        title: "Source URL belongs in the action row",
        body: "Fetched raw body.",
        summary:
          "A useful summary should stay readable without repeating the original URL. https://example.com/source-url-action",
        url: "https://example.com/source-url-action",
        publishedAt: "2026-06-05T00:00:00.000Z",
        createdAt: "2026-06-06T00:00:00.000Z",
        sourceName: "Example",
        sourceType: "blog",
        fetchTool: null,
      },
    }),
  );
  const visibleText = html.replace(/<[^>]*>/g, "");

  assert.match(html, /A useful summary should stay readable without repeating the original URL\./);
  assert.match(html, /href="https:\/\/example\.com\/source-url-action"/);
  assert.match(html, />Original</);
  assert.doesNotMatch(visibleText, /https:\/\/example\.com\/source-url-action/);
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

  assert.match(html, /href="\/builder\/entity_github"[\s\S]*GitHub Trending/);
  assert.match(html, /href="\/builder\/entity_ph"[\s\S]*Product Hunt Top Products/);
  assert.match(html, /favicons\?domain=github\.com/);
  assert.match(html, /favicons\?domain=www\.producthunt\.com/);
});

test("recommendation snapshots request six posts at a time", () => {
  assert.match(source("src/lib/recommendations.ts"), /defaultRecommendationLimit = 6/);
  assert.match(source("src/app/api/recommendations/timeline/route.ts"), /itemLimit: 6/);
  assert.doesNotMatch(source("src/app/api/recommendations/timeline/route.ts"), /recommendationScope/);
  assert.match(source("src/app/(workspace)/recommendations/page.tsx"), /permanentRedirect\("\/dashboard\?tab=following"\)/);
  assert.match(source("src/app/api/recommendations/route.ts"), /limit"\) \?\? "6"/);
  assert.doesNotMatch(source("src/app/api/recommendations/route.ts"), /scope: recommendationScope/);
  const feed = source("src/components/RecommendationFeed.tsx");
  assert.match(feed, /limit=6/);
  assert.match(feed, /Following update/);
  assert.doesNotMatch(feed, /Following snapshot/);
  assert.match(feed, /aria-label="Refresh Following posts"/);
  assert.match(feed, /Loading Following posts/);
  assert.doesNotMatch(feed, />\s*Loading\s*<|Loading posts/);
});

test("following recommendation feed uses subscribed builders only", () => {
  const dashboardPage = source("src/app/(workspace)/dashboard/page.tsx");
  const tabs = source("src/components/DashboardHomeTabs.tsx");
  const followingSection = source("src/components/FollowingRecommendationSection.tsx");
  const recommendations = source("src/lib/recommendations.ts");

  assert.match(tabs, /AI Digest/);
  assert.match(tabs, /Following/);
  assert.match(tabs, /Favorites/);
  assert.doesNotMatch(tabs, /For You/);
  assert.match(dashboardPage, /aiDigest=/);
  assert.match(dashboardPage, /FavoritePostsSection/);
  assert.doesNotMatch(dashboardPage, /requestedTab === "favorites"[\s\S]*redirect\("\/dashboard"\)/);
  assert.match(dashboardPage, /FollowingRecommendationSection/);
  assert.match(dashboardPage, /sourceReadiness=\{sourceReadiness\}/);
  assert.match(dashboardPage, /dashboardSourceReadinessForUser/);
  assert.doesNotMatch(dashboardPage, /scope="for-you"/);
  assert.match(followingSection, /\/api\/recommendations\/timeline/);
  assert.match(followingSection, /followedSourceCount/);
  assert.match(followingSection, /fetchedPostCount/);
  assert.match(followingSection, /summarizedPostCount/);
  assert.match(followingSection, /sourceReadiness\.summarizedPostCount === 0/);
  assert.doesNotMatch(followingSection, /sourceReadiness\.fetchedPostCount === 0/);
  assert.match(followingSection, /No followed sources yet/);
  assert.match(followingSection, /href="\/builders\?tab=fetch"[\s\S]*Choose sources/);
  assert.doesNotMatch(followingSection, /href="\/builders\?tab=fetch"[\s\S]*Go to Sources/);
  assert.match(followingSection, /Add sources for AI Digest and Following\./);
  assert.doesNotMatch(followingSection, /Add sources to feed AI Digest and Following\.|Add sources in the Sources tab|AI Digest issues and Following posts|Add sources in Sources\. They feed AI Digest|They feed AI Digest/);
  assert.match(followingSection, /No summarized posts yet/);
  assert.match(followingSection, /No unread posts yet/);
  assert.match(followingSection, /Copy a Fetch sources prompt to summarize followed posts/);
  assert.match(followingSection, /Copy a Fetch sources prompt to check for new posts/);
  assert.doesNotMatch(followingSection, /Following shows the latest unread posts|Following updates when Fetch sources finds new unread posts|Following will update after new unread posts/);
  assert.doesNotMatch(followingSection, /No fetched posts yet|Following can show their latest posts/);
  assert.match(followingSection, /title="Could not load Following posts"/);
  assert.match(followingSection, /Check your connection, then try again\./);
  assert.doesNotMatch(followingSection, /title="Could not load Following"|Something went wrong loading Following|Couldn't load Following/);
  assert.doesNotMatch(followingSection, /Run Fetch sources to summarize followed posts|Run Fetch sources to check for new posts|Use Fetch sources to summarize posts from followed sources|Use Fetch sources to summarize followed posts|Fetch sources to check for new unread posts|Following recommendations can appear|No unread recommendations yet|No posts have been fetched for your followed sources yet|fetching recommendations/);
  assert.match(followingSection, /FetchSourcesPrompt/);
  assert.match(followingSection, /context="library"/);
  assert.doesNotMatch(followingSection, /scope=\$\{scope\}/);
  assert.doesNotMatch(recommendations, /type RecommendationScope/);
  assert.match(recommendations, /export async function getRecommendationTimeline/);
  assert.match(recommendations, /const created = await createRecommendationSnapshot\({[\s\S]*reason: "initial"/);
  assert.match(recommendations, /const defaultTimelineSnapshotLimit = 3/);
  assert.match(recommendations, /loadRecommendationSnapshots\({[\s\S]*excludeSnapshotId: created\.snapshot\?\.id \?\? null/);
  assert.match(recommendations, /\.\.\.\(created\.snapshot \? \[created\.snapshot\] : \[\]\)/);
  assert.match(recommendations, /\.\.\.existing/);
  assert.match(recommendations, /items: \{ some: \{\} \}/);
  assert.match(recommendations, /const subscriptionBuilderIds = subscriptions\.map/);
  assert.match(recommendations, /reason: \{ startsWith: "subscription:" \}/);
  assert.match(recommendations, /const dedupGroups = new Map<string, typeof rawCandidates>\(\)/);
});
