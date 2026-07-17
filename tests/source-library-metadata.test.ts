import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("resolveSourceLibraryMetadata maps cron cadence and display language", async () => {
  const { resolveSourceLibraryMetadata } = await import("../src/lib/source-library-metadata");

  assert.deepEqual(
    resolveSourceLibraryMetadata({
      cronJob: { status: "active", frequencyLabel: "Every day" },
      feedPreference: { summaryLanguage: "zh-TW" },
    }),
    {
      cadenceLabel: "Every day",
      cadenceState: "active",
      languageLabel: "繁體中文",
    },
  );

  assert.deepEqual(
    resolveSourceLibraryMetadata({
      cronJob: { status: "active", frequencyLabel: "" },
      feedPreference: { summaryLanguage: "en" },
    }),
    {
      cadenceLabel: "Stopped",
      cadenceState: "stopped",
      languageLabel: "English",
    },
  );

  assert.deepEqual(
    resolveSourceLibraryMetadata({
      cronJob: { status: "active", frequencyLabel: "   " },
      feedPreference: { summaryLanguage: "en" },
    }),
    {
      cadenceLabel: "Stopped",
      cadenceState: "stopped",
      languageLabel: "English",
    },
  );

  assert.deepEqual(
    resolveSourceLibraryMetadata({
      cronJob: { status: "stopped", frequencyLabel: "Every hour" },
      feedPreference: { summaryLanguage: "ja" },
    }),
    {
      cadenceLabel: "Stopped",
      cadenceState: "stopped",
      languageLabel: "日本語",
    },
  );

  assert.deepEqual(
    resolveSourceLibraryMetadata({
      cronJob: { status: "paused", frequencyLabel: "Every hour" },
      feedPreference: { summaryLanguage: null },
    }),
    {
      cadenceLabel: "Stopped",
      cadenceState: "stopped",
      languageLabel: "Original",
    },
  );

  assert.deepEqual(
    resolveSourceLibraryMetadata({
      cronJob: null,
      feedPreference: undefined,
    }),
    {
      cadenceLabel: "Stopped",
      cadenceState: "stopped",
      languageLabel: "Original",
    },
  );
});

test("getSourceLibraryMetadataByOwnerIds dedupes ids and uses exactly two batch findMany queries", async () => {
  const { getSourceLibraryMetadataByOwnerIds } = await import("../src/lib/source-library-metadata");

  const cronQuery = deferred<Array<{ userId: string; status: string; frequencyLabel: string }>>();
  const preferenceQuery = deferred<Array<{ userId: string; summaryLanguage: string | null }>>();
  const prisma = {
    libraryCronJob: {
      findManyCalls: [] as unknown[],
      findMany(args: unknown) {
        this.findManyCalls.push(args);
        return cronQuery.promise;
      },
    },
    userFeedPreference: {
      findManyCalls: [] as unknown[],
      findMany(args: unknown) {
        this.findManyCalls.push(args);
        return preferenceQuery.promise;
      },
    },
  };

  const pending = getSourceLibraryMetadataByOwnerIds(
    ["owner-1", "owner-2", "owner-1", ""],
    prisma,
  );

  assert.equal(prisma.libraryCronJob.findManyCalls.length, 1);
  assert.equal(prisma.userFeedPreference.findManyCalls.length, 1);
  assert.deepEqual(prisma.libraryCronJob.findManyCalls[0], {
    where: { userId: { in: ["owner-1", "owner-2"] } },
    select: { userId: true, status: true, frequencyLabel: true },
  });
  assert.deepEqual(prisma.userFeedPreference.findManyCalls[0], {
    where: { userId: { in: ["owner-1", "owner-2"] } },
    select: { userId: true, summaryLanguage: true },
  });

  cronQuery.resolve([
    { userId: "owner-1", status: "active", frequencyLabel: "Every day" },
    { userId: "owner-2", status: "disabled", frequencyLabel: "Every hour" },
  ]);
  preferenceQuery.resolve([
    { userId: "owner-1", summaryLanguage: "zh-TW" },
    { userId: "owner-2", summaryLanguage: "ja" },
  ]);

  const metadataByOwnerId = await pending;

  assert.deepEqual(metadataByOwnerId, {
    "owner-1": {
      cadenceLabel: "Every day",
      cadenceState: "active",
      languageLabel: "繁體中文",
    },
    "owner-2": {
      cadenceLabel: "Stopped",
      cadenceState: "stopped",
      languageLabel: "日本語",
    },
  });
});

test("getSourceLibraryMetadataByOwnerIds skips queries for empty owner ids", async () => {
  const { getSourceLibraryMetadataByOwnerIds } = await import("../src/lib/source-library-metadata");

  let queried = false;
  const metadataByOwnerId = await getSourceLibraryMetadataByOwnerIds(["", "  "], {
    libraryCronJob: {
      async findMany() {
        queried = true;
        return [];
      },
    },
    userFeedPreference: {
      async findMany() {
        queried = true;
        return [];
      },
    },
  });

  assert.equal(queried, false);
  assert.deepEqual(metadataByOwnerId, {});
});

test("SourceLibraryMetadata renders icon-only labels with accessible wrappers", async () => {
  const { SourceLibraryMetadata } = await import("../src/components/SourceLibraryMetadata");

  const activeHtml = renderToStaticMarkup(
    createElement(SourceLibraryMetadata, {
      metadata: {
        cadenceLabel: "Every day",
        cadenceState: "active",
        languageLabel: "繁體中文",
      },
    }),
  );
  const stoppedHtml = renderToStaticMarkup(
    createElement(SourceLibraryMetadata, {
      metadata: {
        cadenceLabel: "Stopped",
        cadenceState: "stopped",
        languageLabel: "日本語",
      },
    }),
  );

  assert.match(activeHtml, /aria-label="Frequency: Every day"/);
  assert.match(activeHtml, /aria-label="Language: 繁體中文"/);
  assert.equal(activeHtml.match(/role="group"/g)?.length ?? 0, 2);
  assert.match(activeHtml, /lucide-clock3/);
  assert.match(activeHtml, /lucide-languages/);
  assert.equal(activeHtml.match(/aria-hidden="true"/g)?.length ?? 0, 2);
  assert.doesNotMatch(activeHtml, />Build frequency<|>Frequency<|>Language</);

  assert.match(stoppedHtml, /aria-label="Frequency: Stopped"/);
  assert.match(stoppedHtml, /aria-label="Language: 日本語"/);
  assert.equal(stoppedHtml.match(/role="group"/g)?.length ?? 0, 2);
  assert.match(stoppedHtml, /lucide-circle-stop/);
  assert.match(stoppedHtml, /lucide-languages/);
  assert.equal(stoppedHtml.match(/aria-hidden="true"/g)?.length ?? 0, 2);
});
