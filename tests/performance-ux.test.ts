import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("primary app navigation keeps route prefetching enabled", () => {
  const appNav = source("src/components/AppNav.tsx");

  assert.equal(appNav.includes("prefetch={false}"), false);
});

test("app shell reuses the page session instead of fetching it again", () => {
  const appShell = source("src/components/AppShell.tsx");

  assert.equal(appShell.includes("getServerSession"), false);
  assert.match(appShell, /session\??:/);
});

test("skill context caps personal seen items to keep payloads bounded", () => {
  const contextRoute = source("src/app/api/skill/context/route.ts");

  assert.match(contextRoute, /personalSeenItemLimit/);
  assert.match(contextRoute, /take:\s*personalSeenItemLimit/);
});

test("history page paginates digests instead of rendering the full archive", () => {
  const historyPage = source("src/app/history/page.tsx");

  assert.match(historyPage, /historyPageSize/);
  assert.match(historyPage, /take:\s*historyPageSize/);
});

test("search page uses a client form with pending feedback", () => {
  const searchPage = source("src/app/search/page.tsx");
  const searchForm = source("src/components/SearchForm.tsx");

  assert.match(searchPage, /@\/components\/SearchForm/);
  assert.match(searchForm, /useTransition/);
  assert.match(searchForm, /Searching/);
  assert.doesNotMatch(searchForm, /Semantic|Exact|type="radio"/);
});

test("heavy route sections have route-specific loading fallbacks", () => {
  for (const path of [
    "src/app/admin/loading.tsx",
    "src/app/builders/loading.tsx",
    "src/app/history/loading.tsx",
    "src/app/search/loading.tsx",
  ]) {
    assert.equal(existsSync(join(root, path)), true, path);
  }
});

test("builders page streams crawled content behind a suspense boundary", () => {
  const buildersPage = source("src/app/builders/page.tsx");

  assert.match(buildersPage, /Suspense/);
  assert.match(buildersPage, /RecentCrawledContent/);
});
