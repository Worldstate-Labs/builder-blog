import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSearchQuery,
  withDateSearchOperators,
} from "../src/lib/search";

test("search date refinement rewrites after and before operators", () => {
  const refined = withDateSearchOperators(
    "agent memory after:2026-01-01 before:2026-02-01",
    { after: "2026-03-05", before: "2026-04-10" },
  );

  assert.equal(refined, "agent memory after:2026-03-05 before:2026-04-10");
  const parsed = parseSearchQuery(refined);
  assert.equal(parsed.cleanQuery, "agent memory");
  assert.equal(parsed.after?.toISOString().slice(0, 10), "2026-03-05");
  assert.equal(parsed.before?.toISOString().slice(0, 10), "2026-04-10");
});

test("search date refinement removes cleared or invalid date operators", () => {
  assert.equal(
    withDateSearchOperators("agent memory after:2026-01-01 before:2026-02-01", {
      after: "",
      before: "not-a-date",
    }),
    "agent memory",
  );
});
