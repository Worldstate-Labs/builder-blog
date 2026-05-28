#!/usr/bin/env node
// Build-time migration step for Vercel.
//
// Runs `prisma migrate deploy`, but classifies failures so a transient
// database-connectivity problem (unreachable host, paused/plan-limited
// Prisma Postgres instance) does NOT hard-fail the whole deployment —
// while a genuine migration error (bad SQL, failed migration) still
// blocks the build, because shipping code that expects a new schema
// against an un-migrated database is worse than a failed deploy.
//
// Connectivity/plan failures exit 0 (build proceeds; apply migrations
// once the DB is back). Everything else exits non-zero.
import { spawnSync } from "node:child_process";

// Markers that mean "couldn't reach / use the database server" rather
// than "a migration itself failed". Matched case-insensitively against
// combined stdout+stderr.
const CONNECTIVITY_MARKERS = [
  "P1001", // Can't reach database server
  "P1002", // Database server reached but timed out
  "can't reach database server",
  "planlimitreached",
  "account has restrictions",
  "connection refused",
  "etimedout",
  "econnrefused",
  "getaddrinfo",
];

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy"],
  { encoding: "utf8", shell: false },
);

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";
process.stdout.write(stdout);
process.stderr.write(stderr);

if (result.status === 0) {
  process.exit(0);
}

const haystack = `${stdout}\n${stderr}`.toLowerCase();
const isConnectivity = CONNECTIVITY_MARKERS.some((m) => haystack.includes(m));

if (isConnectivity) {
  console.warn(
    "\n[vercel-migrate] WARNING: could not reach the database to apply " +
      "migrations (unreachable or plan-limited Prisma Postgres). Continuing " +
      "the build anyway. Run `npm run db:deploy` once the database is back " +
      "to apply any pending migrations.\n",
  );
  process.exit(0);
}

// Genuine migration failure (or prisma binary missing) — block the build.
console.error(
  "\n[vercel-migrate] ERROR: `prisma migrate deploy` failed for a " +
    "non-connectivity reason (see output above). Failing the build so the " +
    "problem is not shipped silently.\n",
);
process.exit(result.status ?? 1);
