import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(`${root}/${path}`, "utf8");

test("source avatars prefer cached images and never fall back to initials", () => {
  const avatar = source("src/components/SourceAvatar.tsx");

  assert.match(
    avatar,
    /if \(cachedAvatarUrl && !failedUrls\.has\(cachedAvatarUrl\)\)[\s\S]*if \(realAvatarUrl && !failedUrls\.has\(realAvatarUrl\)\)/,
  );
  assert.match(avatar, /loading=\{eager \? "eager" : "lazy"\}/);
  assert.match(avatar, /<FallbackIcon className="source-avatar-placeholder-icon" \/>/);
  assert.doesNotMatch(avatar, /avatarMonogram|\{monogram\}/);
});

test("combined Brief headline avatars use an icon instead of source initials", () => {
  const headline = source("src/components/DigestHeadlineSummary.tsx");

  assert.match(headline, /Layers3/);
  assert.match(headline, /<Layers3 className="source-avatar-placeholder-icon" \/>/);
  assert.doesNotMatch(headline, /combinedHeadlineAvatarLabel|initials\.join/);
});
