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
    assert.match(component, /aria-label=\{`\$\{subscribed \? "Unfollow" : "Follow"\} \$\{(?:builderName|sourceName)\}`\}/);
    assert.match(component, /subscribed \? "Following" : "Follow"/);
    assert.match(component, /fb-follow-button/);
    assert.doesNotMatch(component, /fb-toggle/);
    assert.doesNotMatch(component, /builder-library-follow-toggle/);
    assert.doesNotMatch(component, /✓ Following/);
  }

  assert.match(libraryActions, /onClick=\{updateSubscription\}/);
  assert.match(detailActions, /onClick=\{\(\) => follow\(!subscribed\)\}/);
  assert.match(libraryActions, /Could not update following for \$\{builderName\}\./);
  assert.match(detailActions, /Could not update following for \$\{sourceName\}\./);
  assert.doesNotMatch(libraryActions, /Could not update follow state\./);
  assert.doesNotMatch(detailActions, /Could not update follow state\./);
  assert.doesNotMatch(libraryActions, /Could not update subscription\./);
  assert.match(libraryActions, /builderName: string/);
  assert.match(detailActions, /sourceName: string/);
});
