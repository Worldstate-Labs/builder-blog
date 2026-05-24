---
name: builder-blog-digest
description: Generate personalized AI builder digests from the Builder Blog central and personal libraries, then sync the digest to the Builder Blog web app. Supports /login for terminal-to-web authentication.
---

# Builder Blog Digest

Use this skill when the user asks for an AI builder digest, Builder Blog feed, personal builder sync, builder summary, or invokes `/login`.

This skill is compatible with Claude Code, OpenClaw, and Codex because it relies only on a local Node CLI and plain JSON.

## Install From Web App

The Builder Blog web app serves this skill and its CLI script. When the user
copies the setup command from the web app, run it as-is. It downloads the
current skill to `~/.builder-blog/SKILL.md`, downloads the CLI to
`~/.builder-blog/builder-digest.mjs`, then starts terminal login:

```bash
/bin/sh -c "$(curl -fsSL https://builder-blog.worldstatelabs.com/api/skill/bootstrap)"
```

For non-production deployments, replace the host with the current Builder Blog
web app URL. Do not assume a local repository checkout exists.

## Commands

### `/login`

Authenticate this terminal or agent session with the Builder Blog web app:

```bash
node ~/.builder-blog/builder-digest.mjs login --app-url "${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}"
```

The command opens a browser verification URL. The user signs in with Google or GitHub, approves the device code, and the CLI stores an agent token in `~/.builder-blog/config.json`.

Never print the token after login.

### Sync Personal Builders

Agents are responsible for crawling user-owned personal builders with
user-owned API keys, subscriptions, cookies, or network access. The Builder Blog
web app only crawls central builders. For personal builders already in the
user's library, run the local crawler and sync the resulting feed items to the
cloud:

```bash
node ~/.builder-blog/builder-digest.mjs crawl-personal --days 30 --limit 3
```

This command:

- fetches `/api/skill/context`;
- filters to every `scope: PERSONAL` builder in the user's library;
- skips already-synced posts by `user + builder + item kind + externalId`;
- crawls each supported source locally from the user's agent environment;
- uses the later of `--days` and the latest stored post creation time for that
  builder as the incremental cutoff unless `--force` is used;
- for YouTube videos, prefers caption transcripts and falls back to feed descriptions;
- when YouTube captions are missing, low quality, or in the wrong language,
  the agent should use user-owned local capabilities instead of asking the web
  app to process the media: download or access the audio/video with the user's
  own tools, transcribe with the user's available model subscription or local
  speech-to-text runtime, translate when needed, and sync the cleaned transcript
  as the item's `body` through `sync-builders`;
- if the transcript exists but is noisy, the agent may use its own model access
  to lightly clean timestamps, repeated fragments, and caption artifacts while
  preserving factual content; record this in `crawlingTool`, for example
  `Codex Desktop (model gpt-5.5) Builder Blog skill crawler (YouTube captions + agent transcript cleanup)`;
- for sources requiring custom subscriptions, scripts, shell access, or model
  work, agents can configure an external crawler command with
  `BUILDER_BLOG_CRAWLER_<SOURCE_TYPE>` or `BUILDER_BLOG_CRAWLER_COMMAND`; the
  command receives JSON on stdin and returns either an item array or
  `{ "items": [...] }`;
- records the crawling tool as the local agent runtime, model, and concrete
  crawler path, for example `Codex Desktop (model gpt-5.5) Builder Blog skill crawler (YouTube RSS + captions)`;
- posts discovered `TWEET`, `BLOG_POST`, or `PODCAST_EPISODE` items back to `/api/skill/builders`.

Use `--force` only when the user explicitly wants to re-sync already-synced
posts:

```bash
node ~/.builder-blog/builder-digest.mjs crawl-personal --days 30 --limit 3 --force
```

Use `--agent-model gpt-5.5` or `BUILDER_BLOG_AGENT_MODEL=gpt-5.5` when the
runtime does not expose the current model automatically.

Agents may also sync already-crawled user-owned sources manually. This is an
`in library` operation, not a digest subscription unless `subscribe` is true:

```bash
node ~/.builder-blog/builder-digest.mjs sync-builders --file /tmp/personal-builders.json
```

Payload shape:

```json
{
  "crawlingTool": "Codex Desktop (model gpt-5.5) Builder Blog skill crawler (manual JSON sync)",
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
node ~/.builder-blog/builder-digest.mjs prepare --days 1
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

node ~/.builder-blog/builder-digest.mjs sync --file /tmp/builder-blog-digest.md --title "AI Builder Digest"
```

After sync, tell the user it is visible in the Builder Blog web app history.

## Status

To check whether the terminal is logged in:

```bash
node ~/.builder-blog/builder-digest.mjs status
```
