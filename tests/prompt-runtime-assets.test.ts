import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { agentSkillFiles } from "../src/lib/agent-skill-files";
import nextConfig from "../next.config";

const PROMPT_RENDER_ROUTES = [
  "/p/[token]",
  "/api/skill/jobs/[job]/skill.md",
] as const;
const COMPLETE_AGENT_RUNTIME_ROUTES = [
  "/api/skill/files/[file]",
  "/api/skill/bundle",
] as const;

const PROMPT_RUNTIME_ASSETS = [
  "./skills/builder-blog-digest/jobs/*.md",
  "./config/local-agent-timeouts.json",
] as const;
const REQUIRED_COMPLETE_AGENT_RUNTIME_HELPERS = [
  "./scripts/media-tool-failures.mjs",
] as const;
const COMPLETE_AGENT_RUNTIME_MANIFEST_ASSETS = Object.values(agentSkillFiles)
  .map(({ sourcePath }) => sourcePath)
  .filter(
    (sourcePath) =>
      !sourcePath.startsWith("skills/builder-blog-digest/jobs/"),
  )
  .map((sourcePath) => `./${sourcePath}`);
const COMPLETE_AGENT_RUNTIME_ASSETS = [
  ...new Set([
    ...COMPLETE_AGENT_RUNTIME_MANIFEST_ASSETS,
    ...REQUIRED_COMPLETE_AGENT_RUNTIME_HELPERS,
    ...PROMPT_RUNTIME_ASSETS,
  ]),
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

for (const route of COMPLETE_AGENT_RUNTIME_ROUTES) {
  test(`${route} traces the complete downloadable agent runtime`, () => {
    assert.ok(tracing, "next.config.ts must declare outputFileTracingIncludes");

    const routeAssets = tracing[route];
    assert.ok(routeAssets, `${route} must declare runtime assets`);
    for (const asset of COMPLETE_AGENT_RUNTIME_ASSETS) {
      assert.ok(
        routeAssets.includes(asset),
        `${route} must trace ${asset}`,
      );
    }
  });
}

test("bootstrap route traces the embedded bundle installer", () => {
  assert.ok(tracing, "next.config.ts must declare outputFileTracingIncludes");
  assert.ok(
    tracing["/api/skill/bootstrap"]?.includes(
      "./scripts/install-agent-skill-bundle.cjs",
    ),
  );
});

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

test("trace verifier explicitly tracks every non-prompt runtime asset from the canonical manifest", () => {
  const verifierScript = readFileSync(
    "scripts/verify-prompt-runtime-traces.mjs",
    "utf8",
  );
  const assetListMatch = verifierScript.match(
    /const completeAgentRuntimeAssetRelativePaths = \[([\s\S]*?)\];/,
  );

  assert.ok(
    assetListMatch,
    "scripts/verify-prompt-runtime-traces.mjs must declare a machine-checkable completeAgentRuntimeAssetRelativePaths list",
  );

  const verifierAssets = [
    ...assetListMatch[1].matchAll(/"([^"]+)"/g),
  ].map((match) => `./${match[1]}`);

  assert.deepEqual(
    verifierAssets.sort(),
    [
      ...new Set([
        ...COMPLETE_AGENT_RUNTIME_MANIFEST_ASSETS,
        ...REQUIRED_COMPLETE_AGENT_RUNTIME_HELPERS,
      ]),
    ].sort(),
    "scripts/verify-prompt-runtime-traces.mjs must explicitly expect every non-prompt agent runtime asset from agentSkillFiles",
  );
});
