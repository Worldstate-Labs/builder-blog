import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cloudLanguageLibraryHubName,
  copyBuilderToCloudOwner,
  effectiveCloudFetchFrequency,
  upsertSourceCandidateFromCloudBuilder,
} from "../src/lib/cloud-source-library";

test("copyBuilderToCloudOwner preserves source identity while changing owner", async () => {
  const calls: unknown[] = [];
  const result = await copyBuilderToCloudOwner({
    cloudOwnerUserId: "cloud-owner-zh",
    userBuilder: {
      kind: "BLOG",
      sourceType: "blog",
      name: "Anthropic Engineering",
      handle: null,
      sourceUrl: "https://www.anthropic.com/engineering",
      fetchUrl: null,
      avatarUrl: "https://example.com/avatar.png",
      avatarDataUrl: null,
      bio: "Engineering posts",
    },
    upsert: async (params) => {
      calls.push(params);
      return { id: "cloud-builder" };
    },
  });

  assert.deepEqual(result, { id: "cloud-builder" });
  assert.deepEqual(calls, [
    {
      ownerUserId: "cloud-owner-zh",
      kind: "BLOG",
      sourceType: "blog",
      name: "Anthropic Engineering",
      handle: null,
      sourceUrl: "https://www.anthropic.com/engineering",
      fetchUrl: null,
      avatarUrl: "https://example.com/avatar.png",
      avatarDataUrl: null,
      bio: "Engineering posts",
      addedByUserId: null,
    },
  ]);
});

test("effectiveCloudFetchFrequency chooses daily when any active submission is daily", () => {
  assert.equal(effectiveCloudFetchFrequency(["WEEKLY", "DAILY", "WEEKLY"]), "DAILY");
  assert.equal(effectiveCloudFetchFrequency(["WEEKLY"]), "WEEKLY");
  assert.equal(effectiveCloudFetchFrequency([]), null);
});

test("cloud language library names are language-specific hub source libraries", () => {
  assert.equal(cloudLanguageLibraryHubName("zh"), "Community source library - Chinese");
  assert.equal(cloudLanguageLibraryHubName("en"), "Community source library - English");
});

test("cloud source candidate upsert dedupes by canonical source key", async () => {
  const prisma = {
    builder: {
      async findUnique() {
        return {
          id: "builder_zh",
          canonicalKey: "blog:https://example.com/feed",
          name: "Example Feed",
          sourceType: "blog",
          sourceUrl: "https://example.com/feed",
          fetchUrl: "https://example.com/feed",
          handle: null,
          avatarUrl: "https://example.com/favicon.png",
          avatarDataUrl: null,
        };
      },
    },
    sourceCandidate: {
      upsertCalls: [] as unknown[],
      async upsert(args: unknown) {
        this.upsertCalls.push(args);
        return args;
      },
    },
  };

  await upsertSourceCandidateFromCloudBuilder("builder_zh", prisma);

  assert.deepEqual(prisma.sourceCandidate.upsertCalls[0], {
    where: { sourceKey: "blog:https://example.com/feed" },
    update: {
      name: "Example Feed",
      sourceType: "blog",
      sourceUrl: "https://example.com/feed",
      fetchUrl: "https://example.com/feed",
      handle: null,
      avatarUrl: "https://example.com/favicon.png",
      avatarDataUrl: null,
      seedBuilderId: "builder_zh",
      seededFrom: "cloud_source_library",
    },
    create: {
      sourceKey: "blog:https://example.com/feed",
      name: "Example Feed",
      sourceType: "blog",
      sourceUrl: "https://example.com/feed",
      fetchUrl: "https://example.com/feed",
      handle: null,
      avatarUrl: "https://example.com/favicon.png",
      avatarDataUrl: null,
      seedBuilderId: "builder_zh",
      seededFrom: "cloud_source_library",
    },
  });
});

test("cloud language backfill script copies featured Hub sources without user submissions", () => {
  const script = readFileSync(
    "scripts/backfill-cloud-language-library-from-admin-library.mts",
    "utf8",
  );

  assert.match(script, /--language/);
  assert.match(script, /--apply/);
  assert.match(script, /dryRun/);
  assert.match(script, /libraryHubEntry\.findFirst/);
  assert.match(script, /isFeatured:\s*true/);
  assert.match(script, /cloudLanguageLibrary\.findUnique/);
  assert.match(script, /copyBuilderToCloudOwner/);
  assert.match(script, /cloudOwnerUserId:\s*cloudLibrary\.ownerUserId/);
  assert.match(script, /--create-tasks/);
  assert.match(script, /recomputeCloudSourceTask/);
  assert.match(script, /syncCloudLanguageLibraryHub/);
  assert.doesNotMatch(script, /cloudSourceSubmission\.(create|upsert)/);
});
