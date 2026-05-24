---
name: builder-blog-digest
description: Generate personalized AI builder digests from the Builder Blog central and personal libraries, then sync the digest to the Builder Blog web app. Supports /login for terminal-to-web authentication.
---

# Builder Blog Digest

Use this skill when the user asks for an AI builder digest, Builder Blog feed, personal builder sync, builder summary, or invokes `/login`.

This skill is compatible with Claude Code, OpenClaw, Codex, and other local
agents because it relies on a local Node CLI, plain JSON, and scheduled job
prompts that can be run by the user's own agent runtime.

## Install From Web App

The Builder Blog web app serves this skill and its CLI script. When the user
copies the setup command from the web app, run it as-is. It downloads the
current skill to `~/.builder-blog/SKILL.md`, downloads the CLI to
`~/.builder-blog/builder-digest.mjs`, installs scheduled job prompts under
`~/.builder-blog/jobs`, installs the agent runner at
`~/.builder-blog/builder-agent-runner.sh`, then starts terminal login:

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

## Scheduled Jobs

Scheduling has two layers:

- The scheduler (`crontab`, `launchd`, a local agent scheduler, or another
  platform scheduler) only triggers the job at the right time.
- The local agent runtime performs the AI work by reading the installed job
  prompt and using the Builder Blog CLI as a tool.

Use the installed runner instead of scheduling a bare `node` command whenever a
job may require summarization, transcription, cookies, browser access, or model
work:

For copied web-app prompts and scheduled job prompts, treat the instructions as
a runbook: run the named commands in order, keep the paths, flags, cadence,
titles, output files, JSON schema, and success criteria unchanged, and use agent
judgment only in the explicitly marked content-generation or `agentTasks` steps.

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
~/.builder-blog/builder-agent-runner.sh digest-cron
```

The runner chooses the first available execution path:

1. `BUILDER_BLOG_AGENT_COMMAND`, if the user configured one. The command
   receives `BUILDER_BLOG_PROMPT_FILE` and `BUILDER_BLOG_JOB` in the
   environment.
2. Codex CLI.
3. Claude Code CLI.
4. OpenClaw CLI.
5. Gemini CLI.
6. For `library-cron` only, a non-AI crawl fallback for simple supported
   sources. Sources requiring AI, cookies, transcription, or custom tooling
   still require an agent.

Digest cron has no non-AI fallback. If no local agent runtime is available, the
runner exits with a clear log message instead of pretending the digest job is
installed correctly.

Example schedules:

```cron
0 */6 * * * BUILDER_BLOG_URL="https://builder-blog.worldstatelabs.com" $HOME/.builder-blog/builder-agent-runner.sh library-cron >> $HOME/.builder-blog/logs/library-cron.log 2>&1
0 8 * * * BUILDER_BLOG_URL="https://builder-blog.worldstatelabs.com" $HOME/.builder-blog/builder-agent-runner.sh digest-cron >> $HOME/.builder-blog/logs/digest-cron.log 2>&1
```

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
- skips already-crawled posts by `user + builder + item kind + externalId`.
  This uses existing `FeedItem` rows and is independent of whether the user has
  read or viewed the post;
- crawls each supported source locally from the user's agent environment;
- uses the later of `--days` and the latest stored post creation time for that
  builder as the incremental cutoff unless `--force` is used;
- for YouTube videos, primary content must come from captions, transcripts, or
  agent-produced transcription; title, description, and page metadata are
  auxiliary only and must not be synced as the item body;
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
- reports `agentTasks` when primary content is missing or low quality. Treat
  each task as a request for local agent work. Complete exactly the task IDs
  returned by the CLI; do not add new builders, URLs, or feed items that were
  not returned by the CLI or task payload. Completed task items must include
  `rawJson.agentTaskId`, `rawJson.agentRuntime`, `rawJson.agentModel` if known,
  `rawJson.agentCompletedAt`, and `rawJson.agentExecutionProof`. For YouTube,
  include `rawJson.transcriptSource="agent-transcript"` unless a better primary
  transcript source is used. Validate the payload with `validate-agent-sync`,
  then sync completed content with `sync-builders`;
- posts discovered `TWEET`, `BLOG_POST`, or `PODCAST_EPISODE` items back to `/api/skill/builders`.

Validate agent-produced items before syncing them:

```bash
node ~/.builder-blog/builder-digest.mjs validate-agent-sync \
  --tasks /tmp/builder-blog-crawl-result.json \
  --file /tmp/builder-blog-agent-sync.json
```

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
- The only creative step is writing the digest body from those items.
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
