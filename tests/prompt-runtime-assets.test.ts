import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import nextConfig from "../next.config";

const PROMPT_RENDER_ROUTES = [
  "/p/[token]",
  "/api/skill/jobs/[job]/skill.md",
  "/api/skill/files/[file]",
] as const;

const PROMPT_RUNTIME_ASSETS = [
  "./skills/builder-blog-digest/jobs/*.md",
  "./config/local-agent-timeouts.json",
] as const;

const tracing = nextConfig.outputFileTracingIncludes as
  | Record<string, string[]>
  | undefined;

for (const route of PROMPT_RENDER_ROUTES) {
  test(`${route} traces the complete prompt asset directory`, () => {
    assert.ok(tracing, "next.config.ts must declare outputFileTracingIncludes");

    const routeAssets = tracing[route];
    assert.ok(routeAssets, `${route} must declare runtime assets`);
    for (const asset of PROMPT_RUNTIME_ASSETS) {
      assert.ok(
        routeAssets.includes(asset),
        `${route} must trace ${asset}`,
      );
    }
  });
}

test("local and Vercel production builds verify the emitted prompt traces", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };

  for (const scriptName of ["build", "vercel-build"]) {
    assert.match(
      packageJson.scripts?.[scriptName] ?? "",
      /verify-prompt-runtime-traces\.mjs/,
      `${scriptName} must fail when a prompt runtime asset is missing from its server trace`,
    );
  }
});
