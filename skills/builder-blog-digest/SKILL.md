---
name: builder-blog-digest
description: Generate personalized AI builder digests from the Builder Blog central and personal libraries, then sync the digest to the Builder Blog web app. Supports /login for terminal-to-web authentication.
---

# Builder Blog Digest

Use this skill when the user asks for an AI builder digest, Builder Blog feed, personal builder sync, builder summary, or invokes `/login`.

This skill is compatible with Claude Code, OpenClaw, and Codex because it relies only on a local Node CLI and plain JSON.

## Commands

### `/login`

Authenticate this terminal or agent session with the Builder Blog web app:

```bash
cd /Users/jie/code/builder_blog
node scripts/builder-digest.mjs login --app-url "${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}"
```

The command opens a browser verification URL. The user signs in with Google or GitHub, approves the device code, and the CLI stores an agent token in `~/.builder-blog/config.json`.

Never print the token after login.

### Sync Personal Builders

Agents are responsible for crawling user-owned personal builders with
user-owned API keys, subscriptions, cookies, or network access. The Builder Blog
web app only crawls central builders. For personal BLOG builders and personal
YouTube/PODCAST builders already in the user's library, run the local crawler
and sync the resulting feed items to the cloud:

```bash
cd /Users/jie/code/builder_blog
node scripts/builder-digest.mjs crawl-personal --days 3 --limit 3
```

This command:

- fetches `/api/skill/context`;
- filters to `scope: PERSONAL` and `kind: BLOG`, plus YouTube-backed `PODCAST`;
- skips already-synced posts by `user + builder + item kind + externalId`;
- crawls each personal blog or YouTube RSS feed locally from the user's agent environment;
- for YouTube videos, prefers caption transcripts and falls back to feed descriptions;
- posts discovered `BLOG_POST` or `PODCAST_EPISODE` items back to `/api/skill/builders`.

Use `--force` only when the user explicitly wants to re-sync already-synced
posts:

```bash
cd /Users/jie/code/builder_blog
node scripts/builder-digest.mjs crawl-personal --days 3 --limit 3 --force
```

Agents may also sync already-crawled user-owned sources manually. This is an
`in library` operation, not a digest subscription unless `subscribe` is true:

```bash
cd /Users/jie/code/builder_blog
node scripts/builder-digest.mjs sync-builders --file /tmp/personal-builders.json
```

Payload shape:

```json
{
  "builders": [
    {
      "kind": "X",
      "sourceType": "x",
      "name": "Example Builder",
      "handle": "example",
      "sourceUrl": "https://x.com/example",
      "subscribe": false,
      "items": [
        {
          "kind": "TWEET",
          "externalId": "tweet-id",
          "body": "Tweet text",
          "url": "https://x.com/example/status/tweet-id",
          "publishedAt": "2026-05-22T10:00:00.000Z"
        }
      ]
    }
  ]
}
```

`sourceType` is optional. Use it when the storage kind is generic but the
actual source is more specific, for example `pdf`, `youtube`, or
`custom_media`. If omitted, the web app infers the source from `kind` and URL.

### Generate Digest

1. Fetch the user's personalized context:

```bash
cd /Users/jie/code/builder_blog
node scripts/builder-digest.mjs prepare --days 1
```

2. Read the JSON. It contains:

- `subscriptions`: builders the user follows.
- `libraryBuilders`: builders in the user's pool, including central and personal builders.
- `subscriptions`: the subset of `libraryBuilders` included in digest generation.
- `items`: feed items only for subscribed builders.
- `prompts.digest`: the summarization rules.

3. Produce a concise Chinese digest:

- Use only supplied `items`.
- Group by builder or theme.
- Include source URLs for every claim.
- Prioritize launches, technical insights, business moves, strong opinions, and implementation details.
- Do not browse the web or invent missing facts.

4. Sync the final digest to the web app:

```bash
cat > /tmp/builder-blog-digest.md <<'DIGEST'
<final digest text>
DIGEST

cd /Users/jie/code/builder_blog
node scripts/builder-digest.mjs sync --file /tmp/builder-blog-digest.md --title "AI Builder Digest"
```

After sync, tell the user it is visible in the Builder Blog web app history.

## Status

To check whether the terminal is logged in:

```bash
cd /Users/jie/code/builder_blog
node scripts/builder-digest.mjs status
```
