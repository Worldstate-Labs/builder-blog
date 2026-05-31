UPDATE "DigestPipelineShare"
SET "title" = regexp_replace("title", '''s AI Builder Digest$', '''s Digest')
WHERE "title" ~ '''s AI Builder Digest$';
