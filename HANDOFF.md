# Builder Blog Handoff

This document is a continuation note for Codex CLI. Read it first, then inspect the code before editing.

## Project

- Local repo: `/Users/jie/code/builder_blog`
- GitHub repo: `https://github.com/Worldstate-Labs/builder-blog`
- Production app: `https://builder-blog.worldstatelabs.com`
- Vercel project: `worldstatelabs/builder-blog`
- Current branch: `main`
- Current git state at handoff: clean and pushed to `origin/main`

## Product Goal

Build a web app that replicates the `follow-builders` / AI builder digest workflow, with these differences:

- Web UI stores and displays generated digests instead of only sending messages to an agent channel.
- Users can log in with Google or GitHub.
- Users can view today's and historical feeds/digests.
- Users can manage their subscribed builder list.
- There is a centralized builder pool with dedupe.
- A centralized scheduled crawler fetches public content for the builder pool once for all users.
- The digest generation remains a portable skill usable by Claude, OpenClaw, and Codex.
- The skill supports `/login` for terminal-to-web authentication and syncs generated digests back to the web app.

## Current State

The app exists and is deployed. Authentication is working in production.

Verified production login flows:

- GitHub OAuth works: login page opens GitHub authorization, authorization returns to `/dashboard`.
- Google OAuth works: clicking Google returns to `/dashboard`.
- Protected pages work while logged in: `/dashboard`, `/history`, `/builders`, `/settings`, `/device`.
- Protected pages redirect to `/login` when unauthenticated: `/dashboard`, `/history`, `/builders`, `/settings`.

Verified local checks:

```bash
npm run lint
npm run build
```

Both passed after the last code changes.

## Recent Auth Fixes

Important commits:

```text
74ef1ad Refresh GitHub OAuth client id
c121406 Start OAuth through NextAuth client flow
7690ec9 Refresh production deployment environment
f491c1b Establish Builder Blog as a deployable product
```

What was fixed:

- Vercel production OAuth secrets were initially empty. They were re-added in Vercel without printing secret values.
- `GITHUB_ID` had a leading digit `0` instead of uppercase `O`; it was corrected.
- Login buttons previously linked directly to `/api/auth/signin/google` and `/api/auth/signin/github`, which returned `error=google` / `error=github`.
- Login now uses `next-auth/react` `signIn()` from `src/components/AuthButtons.tsx`.

Key files:

- `src/lib/auth.ts`
- `src/components/AuthButtons.tsx`
- `src/app/login/page.tsx`
- `src/app/device/page.tsx`

## Current Architecture

Database models are in `prisma/schema.prisma`.

Important models:

- `Builder`: centralized builder pool.
- `Subscription`: user-to-builder subscription.
- `FeedItem`: crawled raw content.
- `Digest`: generated digest synced from the skill.
- `AgentToken` and `DeviceLogin`: terminal skill authentication.

Important routes:

- `src/app/api/auth/[...nextauth]/route.ts`: NextAuth route.
- `src/app/api/cron/crawl/route.ts`: scheduled crawl endpoint.
- `src/app/api/skill/context/route.ts`: skill fetches user subscriptions and feed items.
- `src/app/api/skill/digests/route.ts`: skill syncs final digest.
- `src/app/api/device/start/route.ts`, `poll/route.ts`, and `src/app/device/page.tsx`: terminal login flow.

Important CLI/skill files:

- `scripts/builder-digest.mjs`
- `skills/builder-blog-digest/SKILL.md`

Vercel cron:

- `vercel.json` schedules `/api/cron/crawl` daily.

## Critical Gap

The current crawler is **not** a full replication of `follow-builders`.

Current behavior in `src/lib/builders.ts`:

- It fetches `https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/config/default-sources.json`.
- It fetches `feed-x.json`, `feed-podcasts.json`, and `feed-blogs.json` from the same upstream repository.
- It imports those upstream feed items into our database.

This means Builder Blog currently consumes `follow-builders`' already-generated public feeds. It does **not** independently crawl the builder pool.

What `follow-builders` actually does in its own `scripts/generate-feed.js`:

- X/Twitter: uses official X API v2, looks up users by handle, fetches recent tweets, excludes retweets/replies, uses `note_tweet.text` for long tweets, caps tweets per user, and tracks seen tweet IDs.
- Podcasts: fetches RSS, filters recent unseen episodes, calls pod2txt for transcripts, polls until transcript is ready, and tries to match the exact YouTube video URL.
- Blogs: scrapes Anthropic Engineering and Claude Blog index pages, discovers recent articles, fetches article pages, extracts article content, and tracks seen article URLs.
- State/dedup: persists `state-feed.json` with `seenTweets`, `seenVideos`, and `seenArticles`.
- GitHub Actions runs this daily and commits updated feed JSON files.

Therefore, user-added builders in Builder Blog are currently stored and can be subscribed to, but they will not be crawled unless they also appear in the upstream `follow-builders` feed.

## Next Task

Implement a real centralized crawler in Builder Blog that reads the database builder pool instead of relying only on upstream `follow-builders` feed JSON.

Recommended implementation direction:

1. Add crawler state storage.
   - Prefer database-backed state instead of a local JSON file, because Vercel functions are stateless.
   - Add a model such as `CrawlState` or track seen IDs through `FeedItem` unique keys plus optional crawler metadata.

2. Port or adapt `follow-builders/scripts/generate-feed.js` logic into local code.
   - Put deterministic crawling code under `src/lib/crawler/` or similar.
   - Keep source-specific modules small: `x.ts`, `podcasts.ts`, `blogs.ts`, `index.ts`.
   - Read from `Builder` rows where `kind` is `X`, `PODCAST`, or `BLOG`.

3. Preserve the existing upstream feed importer as a fallback or one-time seed path.
   - Current `seedDefaultBuilderPool()` and upstream import can remain useful for bootstrapping.
   - Rename clearly if needed, e.g. `importFollowBuildersFeeds()`.

4. Add env vars in Vercel, without committing values.
   - `X_BEARER_TOKEN`
   - `POD2TXT_API_KEY`
   - Existing `CRON_SECRET` remains required for `/api/cron/crawl`.

5. Update `/api/cron/crawl`.
   - It should call the local crawler against the DB builder pool.
   - It should return counts and non-fatal errors by source.
   - It should be safe to run repeatedly.

6. Update the skill/context prompt if needed.
   - Current `src/app/api/skill/context/route.ts` returns one simplified Chinese prompt.
   - `follow-builders` has richer prompt files:
     - `prompts/summarize-podcast.md`
     - `prompts/summarize-tweets.md`
     - `prompts/summarize-blogs.md`
     - `prompts/digest-intro.md`
     - `prompts/translate.md`
   - Consider copying or adapting these prompts into the app or skill so digest quality matches the original.

7. Add tests.
   - Test builder dedupe key behavior.
   - Test crawler transforms remote X/podcast/blog records into `FeedItem`.
   - Test cron route auth.
   - Mock network calls; do not hit X, pod2txt, or blogs in unit tests.

## Important Files To Inspect First

```bash
sed -n '1,320p' src/lib/builders.ts
sed -n '1,220p' src/app/api/cron/crawl/route.ts
sed -n '1,220p' src/app/api/skill/context/route.ts
sed -n '1,220p' scripts/builder-digest.mjs
sed -n '1,220p' prisma/schema.prisma
```

For upstream reference:

```bash
curl -fsSL https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/scripts/generate-feed.js -o /tmp/follow-builders-generate-feed.js
sed -n '1,120p' /tmp/follow-builders-generate-feed.js
sed -n '373,635p' /tmp/follow-builders-generate-feed.js
sed -n '859,1099p' /tmp/follow-builders-generate-feed.js
```

## Deployment Notes

- Pushing to `main` triggers Vercel production deployment.
- Vercel production URL should remain `https://builder-blog.worldstatelabs.com`.
- Do not print or commit OAuth/API secrets.
- If environment variables are changed in Vercel, trigger a new deployment so runtime functions receive them.

## Useful Commands

```bash
cd /Users/jie/code/builder_blog
git status --short --branch
npm run lint
npm run build
vercel ls builder-blog --scope worldstatelabs
curl -fsS https://builder-blog.worldstatelabs.com/api/auth/providers
```

## Known Risks

- There are old Vercel deployments with `UNKNOWN` status from earlier CLI deploy attempts. Latest Git-triggered production deployments are Ready and working.
- The app has no full e2e test suite yet.
- The current cron endpoint imports upstream feeds, so it does not satisfy the real centralized crawler requirement yet.
- User-added non-upstream builders will not receive feed items until the local crawler is implemented.
