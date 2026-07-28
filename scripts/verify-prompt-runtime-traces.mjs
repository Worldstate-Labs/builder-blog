#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const promptDirectory = resolve(
  projectRoot,
  "skills/builder-blog-digest/jobs",
);
const promptAssets = readdirSync(promptDirectory)
  .filter((file) => file.endsWith(".md"))
  .map((file) => resolve(promptDirectory, file))
  .concat(resolve(projectRoot, "config/local-agent-timeouts.json"));
const installerAsset = resolve(
  projectRoot,
  "scripts/install-agent-skill-bundle.cjs",
);
const completeAgentRuntimeAssets = [
  resolve(projectRoot, "scripts/builder-digest.mjs"),
  resolve(projectRoot, "scripts/builder-agent-runner.sh"),
  resolve(projectRoot, "scripts/cloud-shard-budget.mjs"),
  installerAsset,
  resolve(projectRoot, "config/sources.json"),
  ...promptAssets,
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
