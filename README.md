# Builder Blog

Web-native AI builder digest app.

It keeps the core Follow Builders idea but changes delivery from chat messages to a web archive:

- Google and GitHub OAuth login.
- Central builder pool with de-duplicated builder IDs.
- Per-user subscriptions.
- Central crawl endpoint that imports public Follow Builders feeds into one shared pool.
- Per-user raw feed and historical digest archive.
- Agent-compatible skill for `/login`, digest preparation, and syncing generated digests back to the web app.

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
CRON_SECRET="..."
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

## Central Crawl

The crawl endpoint imports the upstream Follow Builders public feeds:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/crawl
```

Schedule that endpoint from your deployment platform cron.

## Agent Skill

Skill file:

```text
skills/builder-blog-digest/SKILL.md
```

Login from terminal:

```bash
npm run skill -- login --app-url http://localhost:3000
```

Prepare personalized context:

```bash
npm run skill -- prepare --days 1
```

After the AI agent writes the digest, sync it:

```bash
npm run skill -- sync --file /tmp/builder-blog-digest.md --title "AI Builder Digest"
```

The synced digest appears in `/dashboard` and `/history`.
