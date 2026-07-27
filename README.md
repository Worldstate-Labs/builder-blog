# FollowBrief

Web-native AI briefing app for people and sources a user follows.

It keeps the core source-following idea but changes delivery from chat messages to a web archive:

- Google and GitHub OAuth login.
- Admin-managed central source pool with de-duplicated source IDs.
- Per-user source pools with a separate digest subscription subset.
- Personal sources synced by the user's own agent.
- Per-user raw feed and historical digest archive.
- Agent-compatible skill for digest preparation and syncing generated digests back to the web app.

## Setup

```bash
cd /Users/jie/code/builder_blog
cp .env.example .env
```

Fill these values in `.env`:

```bash
NEXTAUTH_SECRET="..."
GITHUB_ID="..."
GITHUB_SECRET="..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
X_BEARER_TOKEN="..."
POD2TXT_API_KEY="..."
OPENAI_API_KEY="..."
ADMIN_EMAILS="..."
```

Use a hosted Postgres database for deployed environments. `DATABASE_URL` is used by the app runtime, and `DIRECT_URL` is used by Prisma migrations when your provider exposes a separate direct connection string.

## Database

Generate Prisma Client:

```bash
npm run db:generate
```

Apply migrations:

```bash
npm run db:migrate
```

For production deployments:

```bash
npx prisma migrate deploy
```

Seed and import the central feed:

```bash
npm run db:seed
```

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Agent Skill

The deployed web app serves the skill and CLI script. Users should copy the
setup command from Settings, or run:

```bash
/bin/sh -c "$(curl -fsSL https://followbrief.worldstatelabs.com/api/skill/bootstrap)"
```

The bootstrap installs the CLI and the job-specific skill prompts. Public
endpoints include:

```text
/api/skill/files/builder-digest.mjs
/api/skill/files/builder-blog-library-once.md
/api/skill/files/builder-blog-digest-once.md
/api/skill/jobs/library-once/skill.md
/api/skill/jobs/digest-once/skill.md
```

Authentication is established by copying a one-time prompt from the web app;
the CLI has no separate `login` subcommand.

## Local agent setup

1. Sign in to the web app and create an agent token in Settings.
2. Click "Copy once prompt" on the Sources page (or "Copy cron prompt" for scheduled syncs).
3. Paste the resulting `Read URL?ec=... and follow.` line into your local AI agent (Claude Code, Codex, etc.). The first step the agent runs exchanges the one-time code for an agent token stored locally at `~/.builder-blog/accounts/<your-email>.json`. Subsequent commands authenticate using that file.

Prepare personalized context:

```bash
node ~/.builder-blog/builder-digest.mjs prepare --days 1
```

Locally crawl personal sources in the user's own library and sync the
discovered posts to the cloud. By default it looks back 30 days, then narrows
each source to posts newer than the latest post already stored for that
source unless `--force` is used:

```bash
node ~/.builder-blog/builder-digest.mjs crawl-personal --days 30 --limit 3
```

Sync user-crawled personal sources and items:

```bash
node ~/.builder-blog/builder-digest.mjs sync-builders --file /tmp/personal-builders.json
```

`sync-builders` adds personal sources to the user's pool. Set
`"subscribe": true` on a synced source only when it should also enter the
periodic digest feed.

After the AI agent writes the digest, sync it:

```bash
node ~/.builder-blog/builder-digest.mjs sync --file /tmp/builder-blog-digest.md --title "AI Builder Digest"
```

The synced digest appears in `/dashboard` and `/history`.
