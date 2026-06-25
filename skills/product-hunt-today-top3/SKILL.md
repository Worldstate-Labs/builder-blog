---
name: product-hunt-today-top3
description: Find and report the current top 3 Product Hunt products launching today. Use when the user asks for today's Product Hunt top launches, PH top 3, top upvoted Product Hunt products, or a quick live ranking with names, links, taglines, ranks, and points.
---

# Product Hunt Today Top 3

## Goal

Return the live top 3 Product Hunt launches for the relevant "today", with enough source checking to avoid stale or homepage-only mistakes.

This skill is tool-agnostic: any agent can execute it with a browser, web search, HTTP fetch, or other live web access. Do not rely on model memory.

## Workflow

1. Establish the date context.
   - Use the user's requested date if explicit.
   - Otherwise use the current local/system date and timezone.
   - Treat Product Hunt's visible "Top Products Launching Today" section as the source of truth for what Product Hunt means by today.
   - If local date and Product Hunt date may differ, state both exact dates.

2. Open Product Hunt.
   - Primary URL: `https://www.producthunt.com/`
   - Find the section titled `Top Products Launching Today`.
   - Extract at least the first 5 visible candidates, not only 3, because ranks and points can shift while checking.
   - For each candidate capture:
     - homepage rank
     - product name
     - tagline
     - Product Hunt URL
     - visible numeric fields near the listing

3. Interpret homepage numbers carefully.
   - Product Hunt listings often show two nearby numbers. The smaller number is commonly comment count; the larger number is commonly points/upvotes.
   - Do not assume both numbers are upvotes.
   - Prefer explicit text from product pages such as `Upvote • N points`.

4. Open candidate product pages.
   - Open each likely top candidate's Product Hunt page.
   - Verify it says `Launching today` or `Launching Today`.
   - Capture the explicit `Day Rank` value.
   - Capture the explicit `Upvote • N points` value.
   - Capture the product tagline and external website link if useful.

5. Resolve mismatches.
   - If homepage order and product page rank disagree, prefer product page `Day Rank`.
   - If points differ between pages, prefer the product page value and mention that Product Hunt rankings are live.
   - If a product page is an old parent product page with multiple launches, use the current launch block that says `Launching today`.
   - If Product Hunt is blocked or dynamic content is unavailable, retry with search snippets, Product Hunt product URLs, launch archive pages, or another live web fetch. Clearly label any result that could not be product-page verified.

6. Output the top 3.
   - Default to the user's language.
   - Keep it concise unless the user asks for analysis.
   - Include:
     - rank
     - product name
     - Product Hunt URL
     - points/upvotes
     - one-line tagline or what it does
   - Include source links or citations when the environment supports them.
   - Add a short note if live ranking changed during verification.

## Default Answer Shape

```text
截至我刚查到的 Product Hunt 今日榜单，Top 3 是：

1. [Product](Product Hunt URL) — N points，今日 #1：tagline。
2. [Product](Product Hunt URL) — N points，今日 #2：tagline。
3. [Product](Product Hunt URL) — N points，今日 #3：tagline。

注：Product Hunt 排名和 points 是实时变化的；这里以产品页 Day Rank / Upvote points 为准。
```

## Quality Bar

- Always perform live lookup before answering.
- Do not present "today" results from memory, old screenshots, or previous conversations as current.
- Verify the top 3 against product pages when possible.
- Distinguish comment counts from upvote/point counts.
- Prefer Product Hunt's own pages over third-party summaries.
- Keep the final answer factual; avoid promotional claims unless the user asks for analysis.
