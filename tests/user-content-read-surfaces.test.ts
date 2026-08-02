import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("source feed API reads only the user's logical and mapped cloud builders", () => {
  const route = source("src/app/api/builders/[builderId]/feed-items/route.ts");

  assert.match(route, /resolveUserContentBuilderIds/);
  assert.match(route, /logicalBuilderIds:\s*\[builderId\]/);
  assert.match(route, /builderIds:\s*contentBuilderIds/);
});

test("source cards and detail pages include mapped cloud content", () => {
  const libraryPage = source("src/app/(workspace)/builders/page.tsx");
  const detailPage = source("src/app/(workspace)/builder/[entityId]/page.tsx");

  assert.match(libraryPage, /loadUserContentStatsByEntityId/);
  assert.match(libraryPage, /userContentStatsByEntityId/);
  assert.match(libraryPage, /logicalBuilderIds:\s*poolBuilderIds/);
  assert.match(detailPage, /resolveUserContentBuilderIds/);
  assert.match(detailPage, /logicalBuilderIds:\s*visiblePostBuilderIds/);
  assert.match(detailPage, /countDedupedItemsForEntity\(postBuilderIds\)/);
});

test("digest, search, and recommendations use the same explicit content entitlement", () => {
  const contextRoute = source("src/app/api/skill/context/route.ts");
  const search = source("src/lib/user-search.ts");
  const recommendations = source("src/lib/recommendations.ts");

  assert.match(contextRoute, /resolveUserContentBuilderIds/);
  assert.match(contextRoute, /logicalBuilderIds:\s*\[\.\.\.subscribedBuilderIdSet\]/);
  assert.match(contextRoute, /builderIds:\s*digestContentBuilderIds/);
  assert.match(search, /resolveUserContentBuilderIds/);
  assert.match(search, /logicalBuilderIds:\s*poolBuilderIds/);
  assert.match(search, /builderId:\s*\{\s*in:\s*contentBuilderIds\s*\}/);
  assert.match(recommendations, /resolveUserContentBuilderIds/);
  assert.match(recommendations, /logicalBuilderIds:\s*subscriptionBuilderIds/);
  assert.match(recommendations, /builderId:\s*\{\s*in:\s*contentBuilderIds\s*\}/);
});

test("personal agent fetch state stays scoped to logical library builders", () => {
  const contextRoute = source("src/app/api/skill/context/route.ts");

  assert.match(
    contextRoute,
    /const personalFetchedItems = isLibrary[\s\S]*builderId:\s*\{\s*in:\s*libraryFetchBuilderIds\s*\}/,
  );
  assert.doesNotMatch(
    contextRoute,
    /const personalFetchedItems = isLibrary[\s\S]*builderId:\s*\{\s*in:\s*digestContentBuilderIds\s*\}/,
  );
});
