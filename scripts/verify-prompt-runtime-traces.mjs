#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const promptDirectory = resolve(
  projectRoot,
  "skills/builder-blog-digest/jobs",
);
const promptMarkdownAssets = readdirSync(promptDirectory)
  .filter((file) => file.endsWith(".md"))
  .map((file) => resolve(promptDirectory, file));
const promptRuntimeAssetRelativePaths = [
  "config/local-agent-timeouts.json",
];
const promptAssets = [
  ...promptMarkdownAssets,
  ...promptRuntimeAssetRelativePaths.map((assetPath) =>
    resolve(projectRoot, assetPath),
  ),
];
const installerAsset = resolve(
  projectRoot,
  "scripts/install-agent-skill-bundle.cjs",
);
const completeAgentRuntimeAssetRelativePaths = [
  "scripts/builder-digest.mjs",
  "scripts/new-product-launches.mjs",
  "scripts/builder-agent-runner.sh",
  "scripts/builder-library-cron-install.sh",
  "scripts/cloud-shard-budget.mjs",
  "scripts/run-storage.mjs",
  "scripts/media-tool-failures.mjs",
  "scripts/install-agent-skill-bundle.cjs",
  "config/sources.json",
  "config/local-agent-timeouts.json",
];
const completeAgentRuntimeAssets = [
  ...completeAgentRuntimeAssetRelativePaths.map((assetPath) =>
    resolve(projectRoot, assetPath),
  ),
  ...promptMarkdownAssets,
];

const traceManifests = {
  "short prompt link": {
    path: ".next/server/app/p/[token]/route.js.nft.json",
    expectedAssets: promptAssets,
  },
  "prompt job route": {
    path: ".next/server/app/api/skill/jobs/[job]/skill.md/route.js.nft.json",
    expectedAssets: promptAssets,
  },
  "downloadable runtime route": {
    path: ".next/server/app/api/skill/files/[file]/route.js.nft.json",
    expectedAssets: completeAgentRuntimeAssets,
  },
  "runtime bundle route": {
    path: ".next/server/app/api/skill/bundle/route.js.nft.json",
    expectedAssets: completeAgentRuntimeAssets,
  },
  "bootstrap route": {
    path: ".next/server/app/api/skill/bootstrap/route.js.nft.json",
    expectedAssets: [installerAsset],
  },
};

for (const [label, manifest] of Object.entries(traceManifests)) {
  const manifestPath = resolve(projectRoot, manifest.path);
  const trace = JSON.parse(readFileSync(manifestPath, "utf8"));
  const tracedFiles = new Set(
    trace.files.map((file) => resolve(dirname(manifestPath), file)),
  );
  const missing = manifest.expectedAssets.filter(
    (asset) => !tracedFiles.has(asset),
  );

  if (missing.length > 0) {
    const relativeMissing = missing.map((asset) =>
      asset.slice(projectRoot.length + 1),
    );
    throw new Error(
      `${label} is missing prompt runtime assets:\n${relativeMissing.join("\n")}`,
    );
  }

  console.log(
    `${label}: ${manifest.expectedAssets.length}/${manifest.expectedAssets.length} runtime assets traced`,
  );
}
