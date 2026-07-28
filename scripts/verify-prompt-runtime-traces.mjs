#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const promptDirectory = resolve(
  projectRoot,
  "skills/builder-blog-digest/jobs",
);
const expectedAssets = readdirSync(promptDirectory)
  .filter((file) => file.endsWith(".md"))
  .map((file) => resolve(promptDirectory, file))
  .concat(resolve(projectRoot, "config/local-agent-timeouts.json"));

const traceManifests = {
  "short prompt link": ".next/server/app/p/[token]/route.js.nft.json",
  "prompt job route":
    ".next/server/app/api/skill/jobs/[job]/skill.md/route.js.nft.json",
  "downloadable prompt route":
    ".next/server/app/api/skill/files/[file]/route.js.nft.json",
};

for (const [label, relativeManifestPath] of Object.entries(traceManifests)) {
  const manifestPath = resolve(projectRoot, relativeManifestPath);
  const trace = JSON.parse(readFileSync(manifestPath, "utf8"));
  const tracedFiles = new Set(
    trace.files.map((file) => resolve(dirname(manifestPath), file)),
  );
  const missing = expectedAssets.filter((asset) => !tracedFiles.has(asset));

  if (missing.length > 0) {
    const relativeMissing = missing.map((asset) =>
      asset.slice(projectRoot.length + 1),
    );
    throw new Error(
      `${label} is missing prompt runtime assets:\n${relativeMissing.join("\n")}`,
    );
  }

  console.log(
    `${label}: ${expectedAssets.length}/${expectedAssets.length} prompt runtime assets traced`,
  );
}
