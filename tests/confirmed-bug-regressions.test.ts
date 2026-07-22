import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import { publicSiteOrigin } from "../src/lib/site";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

test("public discovery metadata points only at the primary production domain", () => {
  const robotRules = robots();
  const sitemapEntries = sitemap();

  assert.equal(robotRules.host, publicSiteOrigin);
  assert.equal(robotRules.sitemap, `${publicSiteOrigin}/sitemap.xml`);
  assert.deepEqual(
    sitemapEntries.map(({ url }) => url),
    [publicSiteOrigin, `${publicSiteOrigin}/privacy`, `${publicSiteOrigin}/terms`],
  );

  const nextConfig = source("next.config.ts");
  assert.match(nextConfig, /value: "builder-blog\.worldstatelabs\.com"/);
  assert.match(nextConfig, /destination: "https:\/\/followbrief\.worldstatelabs\.com\/:path\*"/);
  assert.match(nextConfig, /permanent: true/);

  const rootLayout = source("src/app/layout.tsx");
  assert.match(rootLayout, /metadataBase: new URL\(publicSiteOrigin\)/);
  assert.match(rootLayout, /template: "%s \| FollowBrief"/);
  for (const [path, title] of [
    ["src/app/login/page.tsx", "Sign in"],
    ["src/app/privacy/page.tsx", "Privacy"],
    ["src/app/terms/page.tsx", "Terms"],
    ["src/app/(workspace)/dashboard/page.tsx", "Home"],
    ["src/app/(workspace)/builders/page.tsx", "Sources"],
    ["src/app/(workspace)/search/page.tsx", "Search"],
    ["src/app/(workspace)/settings/page.tsx", "Settings"],
  ]) {
    assert.match(source(path), new RegExp(`title: "${title}"`));
  }
});

test("mobile headers retain an accessible brand name without overflowing narrow screens", () => {
  for (const path of [
    "src/components/AppShell.tsx",
    "src/components/PublicHeader.tsx",
    "src/app/not-found.tsx",
  ]) {
    const component = source(path);
    assert.match(component, /<Link[^>]+className="fb-brand"[^>]*>[\s\S]*<span className="fb-brand-name">FollowBrief<\/span>/);
  }

  const globals = source("src/app/globals.css");
  assert.match(globals, /@media \(max-width: 520px\)[\s\S]*\.fb-m-top \.fb-brand-name\s*{[\s\S]*clip: rect\(0, 0, 0, 0\)[\s\S]*position: absolute/);
  assert.match(globals, /\.fb-public-mobile-actions \.fb-login-nav-link\s*{[\s\S]*display: none/);
});

test("settings editor can shrink and wraps its toolbar on mobile", () => {
  const globals = source("src/app/globals.css");
  assert.match(globals, /\.settings-access-grid\s*{[\s\S]*min-width: 0/);
  assert.match(globals, /\.settings-markdown-editor\s*{[\s\S]*max-width: 100%;[\s\S]*min-width: 0/);
  assert.match(globals, /@media \(max-width: 767px\)[\s\S]*\.settings-markdown-toolbar\s*{[\s\S]*flex-wrap: wrap/);
  assert.match(globals, /\.settings-markdown-toolbar-spacer\s*{[\s\S]*flex-basis: 100%/);
});

test("login legal links have an explicit theme-aware contrast color", () => {
  const globals = source("src/app/globals.css");
  assert.match(globals, /\.fb-login-panel-copy a\s*{[\s\S]*color: var\(--accent-strong\)/);
});

test("README lists real skill endpoints and no obsolete CLI login command", () => {
  const readme = source("README.md");
  assert.doesNotMatch(readme, /\/api\/skill\/files\/builder-blog-digest\.md/);
  assert.match(readme, /\/api\/skill\/files\/builder-digest\.mjs/);
  assert.match(readme, /\/api\/skill\/jobs\/library-once\/skill\.md/);
  assert.doesNotMatch(readme, /builder-digest\.mjs login\b/);
});
