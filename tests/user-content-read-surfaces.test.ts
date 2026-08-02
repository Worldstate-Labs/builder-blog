import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

async function loadFeedItemsRouteModule() {
  process.env.DATABASE_URL ??=
    "postgres://followbrief:followbrief@127.0.0.1:5432/followbrief";
  return import("../src/lib/builder-feed-items-route");
}

test("source feed API reads only the user's logical and mapped cloud builders", () => {
  const route = source("src/app/api/builders/[builderId]/feed-items/route.ts");
  const helper = source("src/lib/builder-feed-items-route.ts");

  assert.match(route, /createBuilderFeedItemsGetHandler/);
  assert.match(helper, /resolveUserContentBuilderIds/);
  assert.match(helper, /builderIds:\s*access\.contentBuilderIds/);
  assert.match(helper, /resolveBuilderFeedAccess/);
  assert.match(helper, /logicalBuilderIds:\s*poolBuilderIds/);
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

test("direct admin producer feed route denies users without a reachable logical platform-maintained channel", async () => {
  const { createBuilderFeedItemsGetHandler } = await loadFeedItemsRouteModule();
  const resolveCalls: Array<{ userId: string; logicalBuilderIds: string[] }> = [];
  let fetchCalled = false;
  const session = { user: { id: "user_1" }, expires: "2099-01-01T00:00:00.000Z" };
  const GET = createBuilderFeedItemsGetHandler({
    getCurrentSession: async () => session,
    activePoolBuilderIds: async () => [],
    resolveUserContentBuilderIds: async (params: {
      userId: string;
      logicalBuilderIds: string[];
    }) => {
      resolveCalls.push(params);
      return [];
    },
    fetchDedupedFeedForEntities: async () => {
      fetchCalled = true;
      return [];
    },
    prisma: {
      builder: {
        async findUnique() {
          return { entityId: "entity_launches", sourceType: "new_product_launches" };
        },
      },
      libraryHubItem: {
        async findFirst() {
          return { builderId: "admin_launches" };
        },
      },
    },
  });

  const response = await GET(new Request("https://followbrief.example/api/builders/admin_launches/feed-items"), {
    params: Promise.resolve({ builderId: "admin_launches" }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Source is not in your source library.",
  });
  assert.deepEqual(resolveCalls, [{ userId: "user_1", logicalBuilderIds: [] }]);
  assert.equal(fetchCalled, false);
});

test("direct admin producer feed route allows access through an imported logical platform-maintained channel", async () => {
  const { createBuilderFeedItemsGetHandler } = await loadFeedItemsRouteModule();
  const resolveCalls: Array<{ userId: string; logicalBuilderIds: string[] }> = [];
  const fetchCalls: Array<{
    userId: string;
    entityIds: string[];
    builderIds: string[];
    limit: number;
  }> = [];
  const session = { user: { id: "user_1" }, expires: "2099-01-01T00:00:00.000Z" };
  const GET = createBuilderFeedItemsGetHandler({
    getCurrentSession: async () => session,
    activePoolBuilderIds: async () => ["imported_launches"],
    resolveUserContentBuilderIds: async (params: {
      userId: string;
      logicalBuilderIds: string[];
    }) => {
      resolveCalls.push(params);
      return ["imported_launches", "admin_launches"];
    },
    fetchDedupedFeedForEntities: async (params: {
      userId: string;
      entityIds: string[];
      builderIds?: string[] | null;
      limit?: number;
    }) => {
      fetchCalls.push(params as {
        userId: string;
        entityIds: string[];
        builderIds: string[];
        limit: number;
      });
      return [];
    },
    prisma: {
      builder: {
        async findUnique() {
          return { entityId: "entity_launches", sourceType: "new_product_launches" };
        },
      },
      libraryHubItem: {
        async findFirst() {
          return { builderId: "admin_launches" };
        },
      },
    },
  });

  const response = await GET(new Request("https://followbrief.example/api/builders/admin_launches/feed-items"), {
    params: Promise.resolve({ builderId: "admin_launches" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
  assert.deepEqual(resolveCalls, [{
    userId: "user_1",
    logicalBuilderIds: ["imported_launches"],
  }]);
  assert.deepEqual(fetchCalls, [{
    userId: "user_1",
    entityIds: ["entity_launches"],
    builderIds: ["imported_launches", "admin_launches"],
    limit: 8,
  }]);
});

test("direct admin producer feed route allows access through a private logical platform-maintained channel", async () => {
  const { createBuilderFeedItemsGetHandler } = await loadFeedItemsRouteModule();
  const resolveCalls: Array<{ userId: string; logicalBuilderIds: string[] }> = [];
  const fetchCalls: Array<{
    userId: string;
    entityIds: string[];
    builderIds: string[];
    limit: number;
  }> = [];
  const session = { user: { id: "user_1" }, expires: "2099-01-01T00:00:00.000Z" };
  const GET = createBuilderFeedItemsGetHandler({
    getCurrentSession: async () => session,
    activePoolBuilderIds: async () => ["private_launches"],
    resolveUserContentBuilderIds: async (params: {
      userId: string;
      logicalBuilderIds: string[];
    }) => {
      resolveCalls.push(params);
      return ["private_launches", "admin_launches"];
    },
    fetchDedupedFeedForEntities: async (params: {
      userId: string;
      entityIds: string[];
      builderIds?: string[] | null;
      limit?: number;
    }) => {
      fetchCalls.push(params as {
        userId: string;
        entityIds: string[];
        builderIds: string[];
        limit: number;
      });
      return [];
    },
    prisma: {
      builder: {
        async findUnique() {
          return { entityId: "entity_launches", sourceType: "new_product_launches" };
        },
      },
      libraryHubItem: {
        async findFirst() {
          return { builderId: "admin_launches" };
        },
      },
    },
  });

  const response = await GET(new Request("https://followbrief.example/api/builders/admin_launches/feed-items"), {
    params: Promise.resolve({ builderId: "admin_launches" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
  assert.deepEqual(resolveCalls, [{
    userId: "user_1",
    logicalBuilderIds: ["private_launches"],
  }]);
  assert.deepEqual(fetchCalls, [{
    userId: "user_1",
    entityIds: ["entity_launches"],
    builderIds: ["private_launches", "admin_launches"],
    limit: 8,
  }]);
});

test("non-platform hub feed route still allows direct target access", async () => {
  const { createBuilderFeedItemsGetHandler } = await loadFeedItemsRouteModule();
  const resolveCalls: Array<{ userId: string; logicalBuilderIds: string[] }> = [];
  const session = { user: { id: "user_1" }, expires: "2099-01-01T00:00:00.000Z" };
  const GET = createBuilderFeedItemsGetHandler({
    getCurrentSession: async () => session,
    activePoolBuilderIds: async () => [],
    resolveUserContentBuilderIds: async (params: {
      userId: string;
      logicalBuilderIds: string[];
    }) => {
      resolveCalls.push(params);
      return ["hub_blog"];
    },
    fetchDedupedFeedForEntities: async () => [],
    prisma: {
      builder: {
        async findUnique() {
          return { entityId: "entity_blog", sourceType: "blog" };
        },
      },
      libraryHubItem: {
        async findFirst() {
          return { builderId: "hub_blog" };
        },
      },
    },
  });

  const response = await GET(new Request("https://followbrief.example/api/builders/hub_blog/feed-items"), {
    params: Promise.resolve({ builderId: "hub_blog" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
  assert.deepEqual(resolveCalls, [{
    userId: "user_1",
    logicalBuilderIds: ["hub_blog"],
  }]);
});
