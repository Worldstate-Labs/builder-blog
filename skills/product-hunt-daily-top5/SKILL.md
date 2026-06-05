---
name: product-hunt-daily-top5
description: Research and summarize the top 5 Product Hunt products launching today. Use when the user asks for Product Hunt daily launches, top products today, PH top 5, launch-day product analysis, or a structured report that explains what each product does and why it is strong using Product Hunt comments and/or web research.
---

# Product Hunt Daily Top 5

## Goal

Produce a current, evidence-backed report for the top 5 Product Hunt launches for the relevant day.

## Workflow

1. Confirm the date and timezone.
   - Treat Product Hunt's displayed "Top Products Launching Today" as the source of truth for the launch day.
   - If the system date, user locale, and Product Hunt page imply different dates, state the exact Product Hunt date and the exact local/system date.

2. Fetch the leaderboard.
   - Open `https://www.producthunt.com/`.
   - Extract the first five entries under "Top Products Launching Today".
   - Capture rank, product name, tagline, visible comment count/upvote score when available, and Product Hunt URL.
   - If the homepage is blocked or stale, try Product Hunt search results, launch archive pages, the product pages themselves, or a general web search for the exact date.

3. Open each Product Hunt product page.
   - Extract the launch description, website link, rank/date badge, tags, and maker/hunter notes.
   - Read comments and reviews for evidence of user value. Prefer substantive comments that explain a concrete benefit, objection, use case, or adoption signal.
   - If Product Hunt comments are thin, use web search for the product's official site, launch post, documentation, or credible third-party discussion.

4. Synthesize, do not hype.
   - "What it does" should be specific enough that a reader can understand the workflow or user outcome.
   - "Why it is excellent" must be grounded in evidence: user comments, maker explanations, ranking traction, technical differentiation, pricing/access, community signal, or credible external sources.
   - Separate confirmed facts from inference. Use phrasing like "This is strong because..." only when supported by evidence.

5. Output the requested structure.
   - Default to Chinese if the user asks in Chinese.
   - Include one item per product:
     - Product name
     - What the product specifically does
     - Why it is excellent
     - Product Hunt homepage URL
     - Launch date
   - Include citations or source links for each product when the environment supports them.

## Quality Bar

- Never reuse an old Product Hunt list without checking the live page.
- Do not invent comment sentiment. If a product has no useful comments, say the assessment relies on product page details or web research.
- Avoid ranking explanations based only on upvote count; explain the product's underlying user value.
- Keep the report concise but structured. A table is acceptable for short reports; bullets under each product are better when evidence needs context.
