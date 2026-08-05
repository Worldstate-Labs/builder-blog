import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";

test("active pool entries require live import reachability for HUB_IMPORT rows", async () => {
  const { activeBuilderPoolEntryWhere } = await import("../src/lib/builder-pool");

  assert.deepEqual(activeBuilderPoolEntryWhere("user_a"), {
    userId: "user_a",
    removedAt: null,
    OR: [
      { origin: "PERSONAL_SYNC" },
      {
        origin: "HUB_IMPORT",
        builder: {
          hubItems: {
            some: {
              hubEntry: {
                imports: { some: { userId: "user_a" } },
              },
            },
          },
        },
      },
    ],
  });
});

test("user-visible pool readers share the live import predicate", () => {
  const buildersPage = readFileSync("src/app/(workspace)/builders/page.tsx", "utf8");
  const contentState = readFileSync("src/lib/content-sync-state.ts", "utf8");
  const promptRenderer = readFileSync("src/lib/agent-prompt-renderer-server.ts", "utf8");
  const entityResolver = readFileSync("src/lib/builder-entities.ts", "utf8");
  const libraryState = readFileSync("src/lib/builder-library-state.ts", "utf8");

  assert.equal(
    buildersPage.match(/activeBuilderPoolEntryWhere\(user\.id\)/g)?.length,
    2,
  );
  assert.match(contentState, /activeBuilderPoolEntryWhere\(userId\)/);
  assert.match(promptRenderer, /activeBuilderPoolEntryWhere\(userId\)/);
  assert.match(entityResolver, /activeBuilderPoolEntryWhere\(params\.userId\)/);
  assert.match(libraryState, /activeBuilderPoolEntryWhere\(userId\)/);
});
