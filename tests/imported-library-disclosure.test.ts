import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const buildersPage = readFileSync("src/app/(workspace)/builders/page.tsx", "utf8");
const globals = readFileSync("src/app/globals.css", "utf8");
const disclosurePath = "src/components/ImportedLibraryDisclosure.tsx";
const disclosure = existsSync(disclosurePath) ? readFileSync(disclosurePath, "utf8") : "";

test("the first imported library starts open while later libraries start indented and closed", () => {
  assert.match(buildersPage, /data\.importedLibrarySections\.map\(\(library, index\) =>/);
  assert.match(buildersPage, /defaultOpen=\{index === 0\}/);
  assert.match(buildersPage, /indented=\{index > 0\}/);
  assert.doesNotMatch(buildersPage, /\n\s+indented\n/);
});

test("only the View sources row toggles an imported library", () => {
  assert.match(buildersPage, /<ImportedLibraryDisclosure/);
  assert.doesNotMatch(disclosure, /<details|<summary/);
  assert.match(
    disclosure,
    /className="library-section-summary library-section-summary--static library-section-summary--imported-header"[\s\S]*className="library-section-imported-toggle"/,
  );
  assert.match(disclosure, /aria-expanded=\{isOpen\}/);
  assert.match(disclosure, /hidden=\{!isOpen\}/);
  assert.match(globals, /\.library-section-imported-toggle\s*\{[\s\S]*cursor:\s*pointer/);
  assert.match(globals, /\.library-section-imported-toggle:focus-visible\s*\{/);
});
