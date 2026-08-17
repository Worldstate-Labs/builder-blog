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
      cronJob: { status: "active", frequencyLabel: "Every 12 hours" },
      feedPreference: { summaryLanguage: "en" },
    }),
    {
      cadenceLabel: "Every 12 h",
      cadenceState: "active",
      languageLabel: "English",
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
      feedPreference: { summaryLanguage: "en" },
      cloudFetch: { frequencyLabel: "Daily", summaryLanguage: "ja" },
    }),
    {
      cadenceLabel: "Daily",
      cadenceState: "active",
      languageLabel: "日本語",
    },
  );

  assert.deepEqual(
    resolveSourceLibraryMetadata({
      cronJob: { status: "active", frequencyLabel: "Every hour" },
      feedPreference: { summaryLanguage: "en" },
      cloudFetch: { frequencyLabel: "Daily", summaryLanguage: "ja" },
    }),
    {
      cadenceLabel: "Every hour",
      cadenceState: "active",
      languageLabel: "English",
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

test("getSourceLibraryMetadataByLibraries resolves Cloud fetch through Hub library builders", async () => {
  const metadataModule = await import("../src/lib/source-library-metadata");
  const getSourceLibraryMetadataByLibraries = (
    metadataModule as unknown as {
      getSourceLibraryMetadataByLibraries?: (
        libraries: Array<{ id: string; ownerUserId: string | null; builderIds: string[] }>,
        prisma: unknown,
      ) => Promise<Record<string, unknown>>;
    }
  ).getSourceLibraryMetadataByLibraries ?? (async () => ({}));

  const cronQuery = deferred<Array<{ userId: string; status: string; frequencyLabel: string }>>();
  const preferenceQuery = deferred<Array<{ userId: string; summaryLanguage: string | null }>>();
  const cloudSubmissionQuery = deferred<Array<{
    userBuilderId: string | null;
    cloudBuilderId: string;
    submittedAt: Date;
    cloudBuilder: {
      cloudSourceTask: {
        status: string;
        effectiveFrequency: "DAILY" | "WEEKLY";
        summaryLanguage: string;
      } | null;
    };
  }>>();
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
    cloudSourceSubmission: {
      findManyCalls: [] as unknown[],
      findMany(args: unknown) {
        this.findManyCalls.push(args);
        return cloudSubmissionQuery.promise;
      },
    },
  };

  const pending = getSourceLibraryMetadataByLibraries(
    [
      { id: "library-local", ownerUserId: "owner-1", builderIds: ["builder-1"] },
      { id: "library-cloud", ownerUserId: "owner-2", builderIds: ["builder-2"] },
      { id: "library-cloud-copy", ownerUserId: null, builderIds: ["cloud-builder-3"] },
    ],
    prisma as never,
  );

  assert.equal(prisma.libraryCronJob.findManyCalls.length, 1);
  assert.equal(prisma.userFeedPreference.findManyCalls.length, 1);
  assert.equal(prisma.cloudSourceSubmission.findManyCalls.length, 1);
  assert.deepEqual(prisma.libraryCronJob.findManyCalls[0], {
    where: { userId: { in: ["owner-1", "owner-2"] } },
    select: { userId: true, status: true, frequencyLabel: true },
  });
  assert.deepEqual(prisma.userFeedPreference.findManyCalls[0], {
    where: { userId: { in: ["owner-1", "owner-2"] } },
    select: { userId: true, summaryLanguage: true },
  });
  assert.deepEqual(prisma.cloudSourceSubmission.findManyCalls[0], {
    where: {
      active: true,
      OR: [
        { userBuilderId: { in: ["builder-1", "builder-2", "cloud-builder-3"] } },
        { cloudBuilderId: { in: ["builder-1", "builder-2", "cloud-builder-3"] } },
      ],
      cloudBuilder: { cloudSourceTask: { status: "ACTIVE" } },
    },
    select: {
      userBuilderId: true,
      cloudBuilderId: true,
      submittedAt: true,
      cloudBuilder: {
        select: {
          cloudSourceTask: {
            select: {
              status: true,
              effectiveFrequency: true,
              summaryLanguage: true,
            },
          },
        },
      },
    },
  });

  cronQuery.resolve([
    { userId: "owner-1", status: "active", frequencyLabel: "Every day" },
    { userId: "owner-2", status: "disabled", frequencyLabel: "Every hour" },
  ]);
  preferenceQuery.resolve([
    { userId: "owner-1", summaryLanguage: "zh-TW" },
    { userId: "owner-2", summaryLanguage: "ja" },
  ]);
  cloudSubmissionQuery.resolve([
    {
      userBuilderId: "builder-1",
      cloudBuilderId: "cloud-builder-1",
      submittedAt: new Date("2026-08-15T00:00:00Z"),
      cloudBuilder: {
        cloudSourceTask: {
          status: "ACTIVE",
          effectiveFrequency: "DAILY",
          summaryLanguage: "ja",
        },
      },
    },
    {
      userBuilderId: "builder-2",
      cloudBuilderId: "cloud-builder-2",
      submittedAt: new Date("2026-08-16T00:00:00Z"),
      cloudBuilder: {
        cloudSourceTask: {
          status: "ACTIVE",
          effectiveFrequency: "WEEKLY",
          summaryLanguage: "ko",
        },
      },
    },
    {
      userBuilderId: null,
      cloudBuilderId: "cloud-builder-3",
      submittedAt: new Date("2026-08-17T00:00:00Z"),
      cloudBuilder: {
        cloudSourceTask: {
          status: "ACTIVE",
          effectiveFrequency: "DAILY",
          summaryLanguage: "source",
        },
      },
    },
  ]);

  const metadataByLibraryId = await pending;

  assert.deepEqual(metadataByLibraryId, {
    "library-local": {
      cadenceLabel: "Every day",
      cadenceState: "active",
      languageLabel: "繁體中文",
    },
    "library-cloud": {
      cadenceLabel: "Weekly",
      cadenceState: "active",
      languageLabel: "한국어",
    },
    "library-cloud-copy": {
      cadenceLabel: "Daily",
      cadenceState: "active",
      languageLabel: "Original",
    },
  });
});

test("getSourceLibraryMetadataByLibraries skips queries for empty input", async () => {
  const metadataModule = await import("../src/lib/source-library-metadata");
  const getSourceLibraryMetadataByLibraries = (
    metadataModule as unknown as {
      getSourceLibraryMetadataByLibraries?: (
        libraries: never[],
        prisma: unknown,
      ) => Promise<Record<string, unknown>>;
    }
  ).getSourceLibraryMetadataByLibraries ?? (async () => ({}));

  let queried = false;
  const metadataByLibraryId = await getSourceLibraryMetadataByLibraries([], {
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
    cloudSourceSubmission: {
      async findMany() {
        queried = true;
        return [];
      },
    },
  } as never);

  assert.equal(queried, false);
  assert.deepEqual(metadataByLibraryId, {});
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

  assert.match(activeHtml, /aria-label="Build frequency: Every day"/);
  assert.match(activeHtml, /aria-label="Language: 繁體中文"/);
  assert.equal(activeHtml.match(/role="group"/g)?.length ?? 0, 2);
  assert.match(activeHtml, /lucide-clock3/);
  assert.match(activeHtml, /lucide-globe/);
  assert.equal(activeHtml.match(/aria-hidden="true"/g)?.length ?? 0, 2);
  assert.doesNotMatch(activeHtml, />Build frequency<|>Frequency<|>Language</);

  assert.match(stoppedHtml, /aria-label="Build status: Stopped"/);
  assert.match(stoppedHtml, /aria-label="Language: 日本語"/);
  assert.equal(stoppedHtml.match(/role="group"/g)?.length ?? 0, 2);
  assert.match(stoppedHtml, /lucide-circle-stop/);
  assert.match(stoppedHtml, /lucide-globe/);
  assert.equal(stoppedHtml.match(/aria-hidden="true"/g)?.length ?? 0, 2);
});
