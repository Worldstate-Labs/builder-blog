---
name: builder-blog-digest
description: Generate personalized FollowBrief digests from central and personal source libraries, then sync the digest to the FollowBrief web app. Supports /login for terminal-to-web authentication.
---

# FollowBrief Digest

Use this skill when the user asks for an AI reading digest, FollowBrief feed, personal source sync, source summary, or invokes `/login`.

This skill is compatible with Claude Code, OpenClaw, Codex, and other local
agents because it relies on a local Node CLI, plain JSON, and job prompts that
can be run by the user's own agent runtime.

## Install From Web App

The FollowBrief web app serves this skill and its CLI script. When the user
copies the setup command from the web app, run it as-is. It downloads the
current skill to `~/.builder-blog/SKILL.md`, downloads the CLI to
`~/.builder-blog/builder-digest.mjs`, installs once and scheduled job prompts under
`~/.builder-blog/jobs`, installs the agent runner at
`~/.builder-blog/builder-agent-runner.sh`, then starts terminal login:

```bash
/bin/sh -c "$(curl -fsSL https://builder-blog.worldstatelabs.com/api/skill/bootstrap)"
```

For non-production deployments, replace the host with the current FollowBrief
web app URL. Do not assume a local repository checkout exists.

## Commands

### `/login`

Authenticate this terminal or agent session with the FollowBrief web app:

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
  prompt and using the FollowBrief CLI as a tool.

Use the installed runner instead of scheduling a bare `node` command whenever a
job may require summarization, transcription, cookies, browser access, or model
work:

For copied web-app prompts and scheduled job prompts, treat the instructions as
a runbook: run the named commands in order, keep the paths, flags, cadence,
titles, output files, JSON schema, and success criteria unchanged, and use agent
judgment only in the explicitly marked content-generation or `agentTasks` steps.
Within an `agentTasks` step, failed extraction attempts are not command-contract
failures. The agent should keep using any available local capability until the
task is complete, and stop only when no available method can obtain real primary
content.

```bash
BUILDER_BLOG_URL="${BUILDER_BLOG_URL:-https://builder-blog.worldstatelabs.com}" \
~/.builder-blog/builder-agent-runner.sh library-once
```

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

### Sync Personal Sources

Agents are responsible for crawling user-owned personal sources with
user-owned API keys, subscriptions, cookies, or network access. The FollowBrief
web app only crawls central sources. For personal sources already in the
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
- when YouTube primary content is missing or low quality, the agent should use
  any available user-owned local capability instead of asking the web app to
  process the media. The agent chooses the method; the requirement is to obtain
  real primary content and sync it as the item's `body` through `sync-builders`;
- for every newly crawled or agent-produced post, generate a concise Chinese
  single-post `summary` using only that post's supplied body and metadata. Use
  the same discipline as the digest prompt: include source URLs for every
  claim, prioritize launches, technical insights, funding/business moves,
  strong opinions, and implementation details, and never invent missing facts;
- if the transcript exists but is noisy, the agent may use its own model access
  to lightly clean timestamps, repeated fragments, and caption artifacts while
  preserving factual content; record this in `crawlingTool`, for example
  `Codex Desktop (model gpt-5.5) FollowBrief skill crawler (YouTube captions + agent transcript cleanup)`;
- for sources requiring custom subscriptions, scripts, shell access, or model
  work, agents can configure an external crawler command with
  `BUILDER_BLOG_CRAWLER_<SOURCE_TYPE>` or `BUILDER_BLOG_CRAWLER_COMMAND`; the
  command receives JSON on stdin and returns either an item array or
  `{ "items": [...] }`;
- records the crawling tool as the local agent runtime, model, and concrete
  crawler path, for example `Codex Desktop (model gpt-5.5) FollowBrief skill crawler (YouTube RSS + captions)`;
- reports `agentTasks` when primary content is missing or low quality. Treat
  each task as a request for local agent work. Complete exactly the task IDs
  returned by the CLI; do not add new sources, URLs, or feed items that were
  not returned by the CLI or task payload. Do not stop just because one
  extraction method fails; keep trying available local methods until the content
  is extracted. Stop only if this agent has no remaining available way to obtain
  real primary content for a task, and report the tried methods and concrete
  blocker. Completed task items must include
  `rawJson.agentTaskId`, `rawJson.agentRuntime`, `rawJson.agentModel` if known,
  `rawJson.agentCompletedAt`, and `rawJson.agentExecutionProof`. For YouTube,
  include `rawJson.transcriptSource="agent-transcript"` unless a better primary
  transcript source is used. Validate the payload with `validate-agent-sync`,
  then sync completed content with `sync-builders`;
- reports `summaryTasks` for newly crawled posts that need agent-written
  summaries. Complete exactly those task IDs, write each single-post Chinese
  summary to the item's `summary` field, validate with `validate-agent-sync`,
  then sync with `sync-builders`;
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
  "crawlingTool": "Codex Desktop (model gpt-5.5) FollowBrief skill crawler (manual JSON sync)",
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
          "summary": "中文单篇摘要，基于该 post 正文，不添加外部事实。",
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

- `subscriptions`: sources the user follows.
- `libraryBuilders`: sources in the user's pool, including central and personal sources.
- `subscriptions`: the subset of `libraryBuilders` included in digest generation.
- `items`: feed items only for subscribed sources.
- `prompts.summarizeTweets`: the `summarize-tweets.md` method for X/Twitter items.
- `prompts.summarizePodcast`: the `summarize-podcast.md` method for podcast/video items.
- `prompts.summarizeBlogs`: the `summarize-blogs.md` method for blog items.
- `prompts.digestIntro`: the `digest-intro.md` assembly rules.
- `prompts.translate`: the `translate.md` Chinese translation rules.

3. Produce a concise Chinese digest:

- Use only supplied `items`.
- The only creative step is writing the digest body from those items.
- Group items by source type and builder/source.
- First summarize X/Twitter, podcast/video, and blog items with their matching
  source-specific prompt.
- Then assemble those summaries with `prompts.digestIntro`.
- Then apply `prompts.translate` for the final natural simplified Chinese digest.
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

After sync, tell the user it is visible in the FollowBrief web app history.

## Status

To check whether the terminal is logged in:

```bash
node ~/.builder-blog/builder-digest.mjs status
```
