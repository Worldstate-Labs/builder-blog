import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { crossTypeWarning } from "../src/lib/source-value-detect";
import { recordBackupSourceCandidateFromManualBuilder } from "../src/lib/source-candidate-backup";

test("curated source candidates do not trigger source-type switch suggestions", async () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/source-candidate-library.ts"),
    "utf8",
  );
  const warnings = source
    .split("\n")
    .flatMap((line) => {
      if (!line.includes("{ name:")) return [];
      const name = line.match(/name:\s*"([^"]+)"/)?.[1];
      const sourceType = line.match(/sourceType:\s*"([^"]+)"/)?.[1];
      const sourceUrl = line.match(/sourceUrl:\s*"([^"]+)"/)?.[1];
      if (!name || !sourceType || !sourceUrl) return [];
      const warning = crossTypeWarning(sourceType, sourceUrl);
      return warning ? [{ name, sourceType, sourceUrl, suggestId: warning.suggestId }] : [];
    });

  assert.deepEqual(warnings, []);
});

test("manual sources absent from the primary candidate library are upserted into the backup candidate library", async () => {
  const now = new Date("2026-07-10T12:00:00.000Z");
  const prisma = {
    sourceCandidate: {
      findUniqueCalls: [] as unknown[],
      async findUnique(args: unknown) {
        this.findUniqueCalls.push(args);
        return null;
      },
    },
    backupSourceCandidate: {
      upsertCalls: [] as unknown[],
      async upsert(args: unknown) {
        this.upsertCalls.push(args);
        return args;
      },
    },
  };

  const result = await recordBackupSourceCandidateFromManualBuilder({
    builder: {
      id: "builder_user_1",
      canonicalKey: "blog:https://example.com/feed",
      name: "Example Feed",
      sourceType: "blog",
      sourceUrl: "https://example.com/feed",
      fetchUrl: "https://example.com/feed.xml",
      handle: null,
      avatarUrl: "https://example.com/favicon.png",
      avatarDataUrl: null,
    },
    userId: "user_1",
    prismaClient: prisma,
    now,
  });

  assert.equal(result.status, "recorded");
  assert.deepEqual(prisma.sourceCandidate.findUniqueCalls[0], {
    where: { sourceKey: "blog:https://example.com/feed" },
    select: { id: true },
  });
  assert.deepEqual(prisma.backupSourceCandidate.upsertCalls[0], {
    where: { sourceKey: "blog:https://example.com/feed" },
    update: {
      name: "Example Feed",
      sourceType: "blog",
      sourceUrl: "https://example.com/feed",
      fetchUrl: "https://example.com/feed.xml",
      handle: null,
      avatarUrl: "https://example.com/favicon.png",
      avatarDataUrl: null,
      lastBuilderId: "builder_user_1",
      lastAddedByUserId: "user_1",
      lastSeenAt: now,
      seenCount: { increment: 1 },
    },
    create: {
      sourceKey: "blog:https://example.com/feed",
      name: "Example Feed",
      sourceType: "blog",
      sourceUrl: "https://example.com/feed",
      fetchUrl: "https://example.com/feed.xml",
      handle: null,
      avatarUrl: "https://example.com/favicon.png",
      avatarDataUrl: null,
      firstBuilderId: "builder_user_1",
      lastBuilderId: "builder_user_1",
      firstAddedByUserId: "user_1",
      lastAddedByUserId: "user_1",
      seenCount: 1,
      lastSeenAt: now,
    },
  });
});

test("manual sources already in the primary candidate library do not duplicate into backup candidates", async () => {
  const prisma = {
    sourceCandidate: {
      async findUnique() {
        return { id: "candidate_1" };
      },
    },
    backupSourceCandidate: {
      upsertCalls: [] as unknown[],
      async upsert(args: unknown) {
        this.upsertCalls.push(args);
        return args;
      },
    },
  };

  const result = await recordBackupSourceCandidateFromManualBuilder({
    builder: {
      id: "builder_user_1",
      canonicalKey: "X:karpathy",
      name: "Andrej Karpathy",
      sourceType: "x",
      sourceUrl: "https://x.com/karpathy",
      fetchUrl: null,
      handle: "karpathy",
      avatarUrl: null,
      avatarDataUrl: null,
    },
    userId: "user_1",
    prismaClient: prisma,
  });

  assert.equal(result.status, "already_candidate");
  assert.deepEqual(prisma.backupSourceCandidate.upsertCalls, []);
});

test("admin settings exposes primary and backup source candidate libraries", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migration = readFileSync(
    join(process.cwd(), "prisma/migrations/000086_backup_source_candidates/migration.sql"),
    "utf8",
  );
  const helper = readFileSync(
    join(process.cwd(), "src/lib/source-candidate-backup.ts"),
    "utf8",
  );
  const personalRoute = readFileSync(
    join(process.cwd(), "src/app/api/builders/personal/route.ts"),
    "utf8",
  );
  const settingsPage = readFileSync(
    join(process.cwd(), "src/app/(workspace)/settings/page.tsx"),
    "utf8",
  );
  const panel = readFileSync(
    join(process.cwd(), "src/components/AdminSourceCandidateLibraries.tsx"),
    "utf8",
  );
  const styles = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  assert.match(schema, /model BackupSourceCandidate \{/);
  assert.match(schema, /sourceKey\s+String\s+@unique/);
  assert.match(schema, /seenCount\s+Int\s+@default\(1\)/);
  assert.match(migration, /CREATE TABLE "BackupSourceCandidate"/);
  assert.match(migration, /CREATE UNIQUE INDEX "BackupSourceCandidate_sourceKey_key"/);

  assert.match(helper, /recordBackupSourceCandidateFromManualBuilder/);
  assert.match(helper, /sourceCandidate\.findUnique/);
  assert.match(helper, /backupSourceCandidate\.upsert/);
  assert.match(helper, /seenCount:\s*\{\s*increment:\s*1\s*\}/);
  assert.match(helper, /listAdminSourceCandidateLibraries/);

  assert.match(personalRoute, /recordBackupSourceCandidateFromManualBuilder/);
  assert.match(personalRoute, /canonicalKey:\s*builder\.canonicalKey/);
  assert.match(personalRoute, /\[personal-builder\] backup candidate record failed/);

  assert.match(settingsPage, /AdminSourceCandidateLibraries/);
  assert.match(settingsPage, /ensureSourceCandidateSeeded/);
  assert.match(settingsPage, /listAdminSourceCandidateLibraries/);
  assert.match(settingsPage, /Source candidate libraries/);
  assert.match(panel, /Primary candidates/);
  assert.match(panel, /Backup candidates/);
  assert.match(panel, /fb-segmented-tabs/);
  assert.match(panel, /SourceAvatar/);
  assert.match(panel, /RelativeTime/);
  assert.match(styles, /\.source-candidate-admin-panel\s*{/);
  assert.match(styles, /\.source-candidate-admin-row\s*{/);
});
