import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BuilderKind } from "@prisma/client";
import {
  compactAvatarUrl,
  faviconDownloadFallbackUrl,
} from "../src/lib/builder-enrichment";
import { resolveSourceAvatar } from "../src/lib/source-avatar-persistence";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("curated candidate refresh preserves an existing avatar snapshot", () => {
  const candidateLibrary = source("src/lib/source-candidate-library.ts");

  assert.match(
    candidateLibrary,
    /avatarDataUrl:\s*existing\?\.avatarDataUrl\s*\?\?\s*seed\.avatarDataUrl/,
  );
});

test("manual and Agent-created sources resolve and persist candidate avatars", () => {
  const personalRoute = source("src/app/api/builders/personal/route.ts");
  const feedSync = source("src/lib/builder-feed-sync.ts");

  assert.match(personalRoute, /resolveSourceAvatar/);
  assert.match(feedSync, /resolveSourceAvatar/);
  assert.match(feedSync, /avatarUrl:\s*avatar\.avatarUrl/);
  assert.match(feedSync, /avatarDataUrl:\s*avatar\.avatarDataUrl/);
});

test("avatar snapshots request compact upstream images and can be backfilled", () => {
  const enrichment = source("src/lib/builder-enrichment.ts");
  const packageJson = source("package.json");
  const backfill = source("scripts/backfill-avatar-cache.ts");

  assert.match(enrichment, /compactAvatarUrl/);
  assert.match(enrichment, /s160-c-k-c0x00ffffff-no-rj/);
  assert.match(packageJson, /"avatars:backfill"/);
  assert.match(backfill, /avatarDataUrl:\s*null/);
  assert.match(backfill, /resolveAvatarDataUrl/);
});

test("source avatar resolution reuses a matching candidate snapshot", async () => {
  const avatar = await resolveSourceAvatar({
    source: {
      kind: BuilderKind.X,
      name: "Andrej Karpathy",
      sourceType: "x",
      handle: "karpathy",
      sourceUrl: "https://x.com/karpathy",
    },
    prismaClient: {
      sourceCandidate: {
        async findUnique(args) {
          assert.deepEqual(args, {
            where: { sourceKey: "X:karpathy" },
            select: { avatarUrl: true, avatarDataUrl: true },
          });
          return {
            avatarUrl: "https://pbs.twimg.com/profile_images/avatar.jpg",
            avatarDataUrl: "data:image/jpeg;base64,YXZhdGFy",
          };
        },
      },
    },
  });

  assert.deepEqual(avatar, {
    avatarUrl: "https://pbs.twimg.com/profile_images/avatar.jpg",
    avatarDataUrl: "data:image/jpeg;base64,YXZhdGFy",
  });
});

test("YouTube snapshots request a compact image instead of the s900 seed", () => {
  assert.equal(
    compactAvatarUrl(
      "https://yt3.googleusercontent.com/channel-avatar=s900-c-k-c0x00ffffff-no-rj",
    ),
    "https://yt3.googleusercontent.com/channel-avatar=s160-c-k-c0x00ffffff-no-rj",
  );
});

test("X snapshots request the compact profile image variant", () => {
  assert.equal(
    compactAvatarUrl(
      "https://pbs.twimg.com/profile_images/1131851609774985216/OcsssQ9J.png",
    ),
    "https://pbs.twimg.com/profile_images/1131851609774985216/OcsssQ9J_normal.png",
  );
});

test("ordinary sources receive a domain favicon when no metadata avatar exists", async () => {
  const avatar = await resolveSourceAvatar({
    source: {
      kind: BuilderKind.BLOG,
      name: "NASA",
      sourceType: "blog",
      sourceUrl: "https://www.nasa.gov/feed/",
    },
    prismaClient: {
      sourceCandidate: {
        async findUnique() {
          return null;
        },
      },
    },
  });

  assert.equal(
    avatar.avatarUrl,
    "https://www.google.com/s2/favicons?domain=www.nasa.gov&sz=128",
  );
});

test("Google favicon snapshots can fall back to the site's own favicon", () => {
  assert.equal(
    faviconDownloadFallbackUrl(
      "https://www.google.com/s2/favicons?domain=github.blog&sz=64",
    ),
    "https://github.blog/favicon.ico",
  );
});

test("account avatar failures use a stable icon instead of a name initial", () => {
  const userMenu = source("src/components/UserMenu.tsx");

  assert.match(userMenu, /UserRound/);
  assert.match(userMenu, /onError=\{\(\) => setAvatarFailed\(true\)\}/);
  assert.doesNotMatch(userMenu, /\{initial\}/);
});
