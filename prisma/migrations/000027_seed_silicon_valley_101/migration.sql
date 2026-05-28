-- Seed the curated Chinese-language podcast 硅谷101 into the featured
-- community library. Apple Podcasts directory URL is the user-facing
-- source URL (recognizable); the resolved Fireside RSS feedUrl is the
-- machine-facing fetchUrl. Idempotent: re-running the migration after
-- the seed exists is a no-op via ON CONFLICT DO NOTHING.
--
-- The block is also a no-op when the admin user (jie@worldstatelabs.com)
-- or the featured library hasn't been created yet — that happens on a
-- fresh database before the admin signs in. In that case, re-applying
-- this migration after admin onboarding will insert the row. (Prisma's
-- migrate-deploy is safe to re-apply because every statement is
-- guarded by an existence check or ON CONFLICT.)

DO $$
DECLARE
  v_admin_user_id    TEXT;
  v_featured_lib_id  TEXT;
  v_entity_id        TEXT := 'seed_sv101_entity';
  v_builder_id       TEXT := 'seed_sv101_builder';
  v_apple_url        TEXT := 'https://podcasts.apple.com/us/podcast/%E7%A1%85%E8%B0%B7101/id1498541229';
  v_feed_url         TEXT := 'https://feeds.fireside.fm/sv101/rss';
  v_bio              TEXT := '一档关注硅谷与中国科技前沿趋势的深度访谈播客，由媒体人陈泓君主理。Available across Apple Podcasts, Spotify, 小宇宙, 喜马拉雅, and YouTube — all platforms surface the same Fireside-hosted RSS feed.';
BEGIN
  -- Admin lookup. Mirrors src/lib/admin.ts DEFAULT_ADMIN_EMAILS.
  SELECT id INTO v_admin_user_id
  FROM "User"
  WHERE lower(email) = 'jie@worldstatelabs.com'
  LIMIT 1;

  IF v_admin_user_id IS NULL THEN
    RAISE NOTICE '硅谷101 seed: skipping — admin user has not signed in yet.';
    RETURN;
  END IF;

  -- Featured community library lookup. Mirrors findAdminCommunityLibrary().
  SELECT id INTO v_featured_lib_id
  FROM "LibraryHubEntry"
  WHERE "isFeatured" = TRUE
  ORDER BY "updatedAt" DESC
  LIMIT 1;

  IF v_featured_lib_id IS NULL THEN
    RAISE NOTICE '硅谷101 seed: skipping — no featured library yet.';
    RETURN;
  END IF;

  -- BuilderEntity (canonical creator identity).
  INSERT INTO "BuilderEntity" (
    id, "canonicalKey", kind, name, handle, bio, "createdAt", "updatedAt"
  ) VALUES (
    v_entity_id, 'podcast:sv101', 'PODCAST', '硅谷101', 'sv101', v_bio, NOW(), NOW()
  ) ON CONFLICT ("canonicalKey") DO NOTHING;

  -- Resolve the entity id we'll actually link against (existing or new).
  SELECT id INTO v_entity_id
  FROM "BuilderEntity"
  WHERE "canonicalKey" = 'podcast:sv101'
  LIMIT 1;

  -- Builder row owned by the admin. sourceType = 'podcast' (Apple
  -- Podcasts isn't a separate type — it's a directory over the same
  -- RSS feed Fireside hosts).
  INSERT INTO "Builder" (
    id, "ownerUserId", kind, name, handle, "canonicalKey", "libraryKey",
    "sourceType", "sourceUrl", "fetchUrl", bio, "addedByUserId", "entityId",
    "lastFetchedAt", "lastForcedAt", "itemCount", status, "lastError",
    "createdAt", "updatedAt"
  ) VALUES (
    v_builder_id, v_admin_user_id, 'PODCAST', '硅谷101', 'sv101',
    'podcast:sv101', 'seed:podcast:sv101',
    'podcast', v_apple_url, v_feed_url, v_bio, v_admin_user_id, v_entity_id,
    NULL, NULL, 0, 'IDLE', NULL,
    NOW(), NOW()
  ) ON CONFLICT ("libraryKey") DO NOTHING;

  -- Resolve the builder id we'll actually link against.
  SELECT id INTO v_builder_id
  FROM "Builder"
  WHERE "libraryKey" = 'seed:podcast:sv101'
  LIMIT 1;

  -- LibraryHubItem links 硅谷101 to the featured community library so
  -- everyone who imports that library gets the podcast in their pool.
  INSERT INTO "LibraryHubItem" ("hubEntryId", "builderId", "createdAt")
  VALUES (v_featured_lib_id, v_builder_id, NOW())
  ON CONFLICT ("hubEntryId", "builderId") DO NOTHING;
END $$;
