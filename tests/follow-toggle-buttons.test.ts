import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), "utf8");
}

test("source follow controls use one button that toggles Follow and Unfollow", () => {
  const libraryActions = source("src/components/BuilderLibraryActions.tsx");
  const detailActions = source("src/components/BuilderDetailActions.tsx");

  for (const component of [libraryActions, detailActions]) {
    assert.match(component, /aria-pressed=\{subscribed\}/);
    assert.match(component, /aria-label=\{subscribed \? "Unfollow" : "Follow"\}/);
    assert.match(component, /subscribed \? "Unfollow" : "Follow"/);
    assert.doesNotMatch(component, /✓ Following/);
  }

  assert.match(libraryActions, /onClick=\{updateSubscription\}/);
  assert.match(detailActions, /onClick=\{\(\) => follow\(!subscribed\)\}/);
});
