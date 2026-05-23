-- Speed up hybrid search candidate recall for case-insensitive substring
-- matching before the application re-ranks candidates in memory.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Builder_name_search_idx"
  ON "Builder" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Builder_handle_search_idx"
  ON "Builder" USING GIN ("handle" gin_trgm_ops);
CREATE INDEX "Builder_sourceUrl_search_idx"
  ON "Builder" USING GIN ("sourceUrl" gin_trgm_ops);
CREATE INDEX "Builder_crawlUrl_search_idx"
  ON "Builder" USING GIN ("crawlUrl" gin_trgm_ops);
CREATE INDEX "Builder_bio_search_idx"
  ON "Builder" USING GIN ("bio" gin_trgm_ops);
CREATE INDEX "Builder_canonicalKey_search_idx"
  ON "Builder" USING GIN ("canonicalKey" gin_trgm_ops);

CREATE INDEX "FeedItem_title_search_idx"
  ON "FeedItem" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "FeedItem_body_search_idx"
  ON "FeedItem" USING GIN ("body" gin_trgm_ops);
CREATE INDEX "FeedItem_sourceName_search_idx"
  ON "FeedItem" USING GIN ("sourceName" gin_trgm_ops);
CREATE INDEX "FeedItem_url_search_idx"
  ON "FeedItem" USING GIN ("url" gin_trgm_ops);

CREATE INDEX "Digest_title_search_idx"
  ON "Digest" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "Digest_content_search_idx"
  ON "Digest" USING GIN ("content" gin_trgm_ops);
CREATE INDEX "Digest_language_search_idx"
  ON "Digest" USING GIN ("language" gin_trgm_ops);
CREATE INDEX "Digest_source_search_idx"
  ON "Digest" USING GIN ("source" gin_trgm_ops);
