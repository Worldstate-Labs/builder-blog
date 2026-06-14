UPDATE "SourceTypeConfig"
SET "fetchPromptBody" = $$# Product Hunt Top Product Fetch Prompt

You are extracting exactly one Product Hunt top-products task for FollowBrief.
Use agent judgment to handle Product Hunt's changing page structure, but keep
the scope bounded: this is structured extraction, not open-ended product
research.

## Required workflow

1. Open `task.item.url`, the Product Hunt product page. Extract only visible
   Product Hunt facts: product name, tagline, launch/rank badge, maker notes,
   website link, tags, vote/comment counts, comments, and launch date when
   visible.
2. If Product Hunt exposes an official website link, open that website and at
   most one directly linked product page such as docs, pricing, about, or
   homepage content that explains the workflow. Do not browse beyond this
   official-site path.
3. Do not use general web search. Do not search or open Reddit, Hacker News,
   X/Twitter, blogs, review sites, news, or other third-party pages unless
   Product Hunt itself links directly to them as the product's official site.
4. Explain what the product concretely does from Product Hunt plus the official
   site only. Identify target user, workflow, and outcome when visible.
5. Explain why it is noteworthy using only visible evidence: Product Hunt rank,
   tagline, maker notes, visible comments/counts, official-site capabilities,
   and the known top-products context from task metadata. Mark any reasonable
   inference explicitly as inference.
6. If a field is hidden, login-gated, blocked, or not visible, write "not
   visible" instead of searching elsewhere.

## Body to return

Return a structured body, not a summary-only stub, using these fields:

Product name:
Rank/date:
Product Hunt URL:
Official website URL:
Product Hunt tagline:
Visible Product Hunt evidence:
Official-site evidence:
What the product does:
Target user:
Workflow:
Why it is noteworthy:
Not visible:
Sources:

Rules:

- Preserve source URLs for every material claim.
- Use "not visible" for hidden Product Hunt comments, counts, makers, pricing,
  docs, or website details.
- Do not invent comment sentiment, numbers, quotes, customers, benchmarks,
  affiliations, pricing, or launch traction.
- Do not include claims from general web search or third-party pages.$$,
    "updatedAt" = NOW()
WHERE "sourceId" = 'product_hunt_top_products'
  AND (
    "fetchPromptBody" IS NULL
    OR (
      "fetchPromptBody" LIKE '# Product Hunt Top Product Fetch Prompt%'
      AND "fetchPromptBody" LIKE '%Use the product''s official website and web search%'
      AND "fetchPromptBody" LIKE '%Hacker News, Reddit%'
    )
  );

UPDATE "UserSourceTypeConfig"
SET "fetchPromptBody" = $$# Product Hunt Top Product Fetch Prompt

You are extracting exactly one Product Hunt top-products task for FollowBrief.
Use agent judgment to handle Product Hunt's changing page structure, but keep
the scope bounded: this is structured extraction, not open-ended product
research.

## Required workflow

1. Open `task.item.url`, the Product Hunt product page. Extract only visible
   Product Hunt facts: product name, tagline, launch/rank badge, maker notes,
   website link, tags, vote/comment counts, comments, and launch date when
   visible.
2. If Product Hunt exposes an official website link, open that website and at
   most one directly linked product page such as docs, pricing, about, or
   homepage content that explains the workflow. Do not browse beyond this
   official-site path.
3. Do not use general web search. Do not search or open Reddit, Hacker News,
   X/Twitter, blogs, review sites, news, or other third-party pages unless
   Product Hunt itself links directly to them as the product's official site.
4. Explain what the product concretely does from Product Hunt plus the official
   site only. Identify target user, workflow, and outcome when visible.
5. Explain why it is noteworthy using only visible evidence: Product Hunt rank,
   tagline, maker notes, visible comments/counts, official-site capabilities,
   and the known top-products context from task metadata. Mark any reasonable
   inference explicitly as inference.
6. If a field is hidden, login-gated, blocked, or not visible, write "not
   visible" instead of searching elsewhere.

## Body to return

Return a structured body, not a summary-only stub, using these fields:

Product name:
Rank/date:
Product Hunt URL:
Official website URL:
Product Hunt tagline:
Visible Product Hunt evidence:
Official-site evidence:
What the product does:
Target user:
Workflow:
Why it is noteworthy:
Not visible:
Sources:

Rules:

- Preserve source URLs for every material claim.
- Use "not visible" for hidden Product Hunt comments, counts, makers, pricing,
  docs, or website details.
- Do not invent comment sentiment, numbers, quotes, customers, benchmarks,
  affiliations, pricing, or launch traction.
- Do not include claims from general web search or third-party pages.$$,
    "updatedAt" = NOW()
WHERE "sourceId" = 'product_hunt_top_products'
  AND (
    "fetchPromptBody" IS NULL
    OR (
      "fetchPromptBody" LIKE '# Product Hunt Top Product Fetch Prompt%'
      AND "fetchPromptBody" LIKE '%Use the product''s official website and web search%'
      AND "fetchPromptBody" LIKE '%Hacker News, Reddit%'
    )
  );
