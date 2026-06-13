---
name: github-daily-trending-report
description: Produce a structured daily report for the GitHub repositories with the most stars today. Use when the user asks for today's GitHub star gainers, GitHub Trending daily analysis, top repositories gaining stars, or a report explaining what trending repositories do and why they are growing quickly.
---

# GitHub Daily Trending Report

## Overview

Generate a current-day report for the repositories gaining the most stars on GitHub. The report must combine GitHub Trending data, each repository's README and repo contents, and web-search evidence about recent attention.

## Workflow

1. Determine the reporting date.
   - Use the user's requested date when explicit.
   - Otherwise use the local date in the user's timezone.
   - State the exact date in the final report.

2. Collect candidates from GitHub Trending.
   - Run `scripts/collect_github_daily_trending.mjs`.
   - Sort by `starsToday` descending, not by page order.
   - Default to the top 5 unless the user asks for another count.

3. Inspect each repository.
   - Read `readme`, `description`, `topics`, `language`, `license`, `homepage`, `root`, `tree`, `releases`, and `commits` from the script output.
   - Use the README for stated product purpose and positioning.
   - Use the file tree and root files to infer implementation shape: apps/packages, CLI entry points, docs, tests, examples, config, deployment files, and language/framework choices.
   - Do not summarize a repository from the trending description alone.

4. Web-search the growth reason.
   - Search each repo name plus terms such as `announcement`, `release`, `Hacker News`, `Reddit`, `Product Hunt`, `Twitter/X`, `blog`, `launch`, and `GitHub trending`.
   - Prefer primary or close-to-primary sources: official repo, docs, release notes, maintainer posts, organization blogs, and large community threads.
   - If evidence is weak, label the reason as an inference and explain the signals used.

5. Produce the report in the user's language.
   - Required fields per project:
     - `项目名称`
     - `项目具体做什么`
     - `为什么涨星快`
     - `项目 URL`
     - `当天日期`
   - Include the observed `stars today` count when available.
   - Add concise source links for GitHub Trending, repo README/release pages, and web-search evidence.

## Script

Run from this skill directory or pass an absolute output path:

```bash
node scripts/collect_github_daily_trending.mjs --top 5 --output /tmp/github-daily-trending.json
```

Options:

```text
--top <n>       Number of repositories to enrich after sorting by stars today. Default: 5.
--since <value> GitHub Trending period. Use daily for this skill. Default: daily.
--output <path> Write enriched JSON to this path. Default: stdout.
```

The script fetches:

- `https://github.com/trending?since=daily`
- GitHub repository metadata
- README from the default branch
- recursive file tree
- recent releases
- recent commits

## Quality Bar

- Verify that the top list is sorted by numeric daily star gain.
- Distinguish facts from inferences.
- Explain growth with evidence: product-market timing, recent release, major community share, recognized maintainer/org, unusually clear demo, or evergreen seasonality.
- Do not claim exact causes when only circumstantial evidence exists.
- Keep the final report structured and scannable.
