UPDATE "SourceTypeConfig"
SET "fetchPromptBody" = replace(
      replace(
        replace(
          replace(
            "fetchPromptBody",
            $$3. Do not use general web search. Do not search or open Reddit, Hacker News,
   X/Twitter, blogs, review sites, news, or other third-party pages unless
   Product Hunt itself links directly to them as the product's official site.
$$,
            ''
          ),
          $$4. Explain what the product concretely does from Product Hunt plus the official$$,
          $$3. Explain what the product concretely does from Product Hunt plus the official$$
        ),
        $$5. Explain why it is noteworthy using only visible evidence: Product Hunt rank,$$,
        $$4. Explain why it is noteworthy using only visible evidence: Product Hunt rank,$$
      ),
      $$6. If a field is hidden, login-gated, blocked, or not visible, write "not$$,
      $$5. If a field is hidden, login-gated, blocked, or not visible, write "not$$
    ),
    "updatedAt" = NOW()
WHERE "sourceId" = 'product_hunt_top_products'
  AND "fetchPromptBody" LIKE '%Do not use general web search. Do not search or open Reddit, Hacker News,%'
  AND "fetchPromptBody" LIKE '%Product Hunt itself links directly to them as the product''s official site.%';

UPDATE "UserSourceTypeConfig"
SET "fetchPromptBody" = replace(
      replace(
        replace(
          replace(
            "fetchPromptBody",
            $$3. Do not use general web search. Do not search or open Reddit, Hacker News,
   X/Twitter, blogs, review sites, news, or other third-party pages unless
   Product Hunt itself links directly to them as the product's official site.
$$,
            ''
          ),
          $$4. Explain what the product concretely does from Product Hunt plus the official$$,
          $$3. Explain what the product concretely does from Product Hunt plus the official$$
        ),
        $$5. Explain why it is noteworthy using only visible evidence: Product Hunt rank,$$,
        $$4. Explain why it is noteworthy using only visible evidence: Product Hunt rank,$$
      ),
      $$6. If a field is hidden, login-gated, blocked, or not visible, write "not$$,
      $$5. If a field is hidden, login-gated, blocked, or not visible, write "not$$
    ),
    "updatedAt" = NOW()
WHERE "sourceId" = 'product_hunt_top_products'
  AND "fetchPromptBody" LIKE '%Do not use general web search. Do not search or open Reddit, Hacker News,%'
  AND "fetchPromptBody" LIKE '%Product Hunt itself links directly to them as the product''s official site.%';
