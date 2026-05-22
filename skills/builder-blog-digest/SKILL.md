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
node scripts/builder-digest.mjs login --app-url "${BUILDER_BLOG_URL:-http://localhost:3000}"
```

The command opens a browser verification URL. The user signs in with Google or GitHub, approves the device code, and the CLI stores an agent token in `~/.builder-blog/config.json`.

Never print the token after login.

### Sync Personal Builders

Agents may crawl user-owned sources with user-owned API keys or subscriptions,
then sync the results into the user's personal library:

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
      "name": "Example Builder",
      "handle": "example",
      "sourceUrl": "https://x.com/example",
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

### Generate Digest

1. Fetch the user's personalized context:

```bash
cd /Users/jie/code/builder_blog
node scripts/builder-digest.mjs prepare --days 1
```

2. Read the JSON. It contains:

- `subscriptions`: builders the user follows.
- `libraryBuilders`: central builders plus the user's personal builders.
- `items`: central feed items plus personal feed items synced by the user's agent.
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
