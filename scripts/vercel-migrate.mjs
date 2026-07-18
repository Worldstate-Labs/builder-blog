#!/usr/bin/env node
// Build-time migration step for Vercel.
//
// Runs `prisma migrate deploy`. Connectivity failures are diagnosed separately
// from bad SQL, but both block the build by default: shipping code that expects
// a new schema against an un-migrated database is worse than a failed deploy.
//
// Set VERCEL_MIGRATE_ALLOW_CONNECTIVITY_SKIP=1 only for an intentional
// emergency deploy where schema drift is acceptable and migrations will be
// applied manually before traffic depends on them.
import { spawnSync } from "node:child_process";

// Markers that mean "couldn't reach / use the database server" rather
// than "a migration itself failed". Matched case-insensitively against
// combined stdout+stderr.
const CONNECTIVITY_MARKERS = [
  "p1001", // Can't reach database server
  "p1002", // Database server reached but timed out
  "can't reach database server",
  "planlimitreached",
  "account has restrictions",
  "connection refused",
  "etimedout",
  "econnrefused",
  "getaddrinfo",
];

const ADVISORY_LOCK_MARKERS = [
  "timed out trying to acquire a postgres advisory lock",
  "select pg_advisory_lock",
];

// Prisma's advisory-lock wait is fixed at 10 seconds per invocation. Twelve
// attempts give overlapping Vercel deployments roughly three minutes to
// finish their migration without disabling the lock or allowing schema drift.
const MAX_ATTEMPTS = positiveInt(process.env.VERCEL_MIGRATE_MAX_ATTEMPTS, 12);
const RETRY_DELAY_MS = positiveInt(process.env.VERCEL_MIGRATE_RETRY_DELAY_MS, 5000);
const ALLOW_CONNECTIVITY_SKIP = process.env.VERCEL_MIGRATE_ALLOW_CONNECTIVITY_SKIP === "1";

let result;
let stdout = "";
let stderr = "";
let haystack = "";

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  result = spawnSync(
    "npx",
    ["prisma", "migrate", "deploy"],
    { encoding: "utf8", shell: false },
  );

  stdout = result.stdout ?? "";
  stderr = result.stderr ?? "";
  process.stdout.write(stdout);
  process.stderr.write(stderr);

  if (result.status === 0) {
    process.exit(0);
  }

  haystack = `${stdout}\n${stderr}`.toLowerCase();
  const isAdvisoryLockTimeout = ADVISORY_LOCK_MARKERS.some((m) => haystack.includes(m));
  if (!isAdvisoryLockTimeout || attempt === MAX_ATTEMPTS) break;

  console.warn(
    `\n[vercel-migrate] WARNING: Prisma migrate is waiting on another ` +
      `migration lock. Retrying ${attempt + 1}/${MAX_ATTEMPTS} in ` +
      `${RETRY_DELAY_MS}ms.\n`,
  );
  sleep(RETRY_DELAY_MS);
}

const isConnectivity = CONNECTIVITY_MARKERS.some((m) => haystack.includes(m));

if (isConnectivity) {
  if (ALLOW_CONNECTIVITY_SKIP) {
    console.warn(
      "\n[vercel-migrate] WARNING: could not reach the database to apply " +
        "migrations, but VERCEL_MIGRATE_ALLOW_CONNECTIVITY_SKIP=1 is set. " +
        "Proceeding with a possible schema drift risk; run `npm run db:deploy` " +
        "before traffic depends on the new schema.\n",
    );
    process.exit(0);
  }

  console.warn(
    "\n[vercel-migrate] WARNING: could not reach the database to apply " +
      "migrations (unreachable or plan-limited Prisma Postgres). Failing " +
      "the build to avoid shipping code against an unverified schema. Set " +
      "VERCEL_MIGRATE_ALLOW_CONNECTIVITY_SKIP=1 only for an intentional " +
      "manual override.\n",
  );
  process.exit(1);
}

// Genuine migration failure (or prisma binary missing) — block the build.
console.error(
  "\n[vercel-migrate] ERROR: `prisma migrate deploy` failed for a " +
    "non-connectivity reason (see output above). Failing the build so the " +
    "problem is not shipped silently.\n",
);
process.exit(result?.status ?? 1);

function positiveInt(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
