import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { crossTypeWarning } from "../src/lib/source-value-detect";

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
