// Read-only readiness check for the cloud source fetch operational smoke.
//
// Run:
//   set -a && . ./.env && . ./.env.local && set +a
//   npx tsx scripts/check-cloud-source-fetch-readiness.mts --language zh --language en
//
// The script intentionally performs no writes. It verifies that the target
// database has the migration, tables, queue uniqueness index, configured
// language owners, and at least one admin user who can call cloud fetch APIs.

type Check = {
  id: string;
  ok: boolean;
  message: string;
  detail?: unknown;
};

type SchemaProbe = {
  migration_applied: boolean;
  has_cloud_fetch_config: boolean;
  has_cloud_language_library: boolean;
  has_cloud_source_submission: boolean;
  has_cloud_source_task: boolean;
  has_cloud_fetch_queue_item: boolean;
  has_cloud_fetch_run: boolean;
  has_cloud_fetch_run_task: boolean;
  has_queue_active_task_index: boolean;
};

function argValues(name: string) {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const next = process.argv[index + 1];
    if (next && !next.startsWith("--")) values.push(next.trim());
  }
  return values.filter(Boolean);
}

function addCheck(checks: Check[], id: string, ok: boolean, message: string, detail?: unknown) {
  checks.push(detail === undefined ? { id, ok, message } : { id, ok, message, detail });
}

function printResult(result: { status: "ready" | "not_ready"; checks: Check[] }) {
  const json = process.argv.includes("--json");
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Cloud source fetch readiness: ${result.status}`);
  for (const check of result.checks) {
    const marker = check.ok ? "ok" : "fail";
    console.log(`- [${marker}] ${check.id}: ${check.message}`);
    if (check.detail !== undefined) {
      console.log(`  ${JSON.stringify(check.detail)}`);
    }
  }
}

async function main() {
  const checks: Check[] = [];
  const expectedLanguages = argValues("--language");
  const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_URL;

  addCheck(
    checks,
    "env.database",
    Boolean(databaseUrl),
    databaseUrl ? "Database URL is configured." : "DATABASE_URL, DATABASE_URL_UNPOOLED, or DIRECT_URL is required.",
  );
  addCheck(
    checks,
    "env.nextauth_secret",
    Boolean(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET),
    "NEXTAUTH_SECRET/AUTH_SECRET is configured for app sessions and agent token encryption.",
  );
  addCheck(
    checks,
    "env.nextauth_url",
    Boolean(process.env.NEXTAUTH_URL),
    "NEXTAUTH_URL is configured for local app auth callbacks.",
  );

  if (!databaseUrl) {
    const result = { status: "not_ready" as const, checks };
    printResult(result);
    process.exitCode = 1;
    return;
  }

  const [{ prisma }, { adminEmails }] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/admin"),
  ]);

  try {
    const [schema] = await prisma.$queryRawUnsafe<SchemaProbe[]>(`
      select
        exists(
          select 1
          from "_prisma_migrations"
          where migration_name = '000080_cloud_source_fetch'
            and finished_at is not null
        ) as migration_applied,
        to_regclass('"CloudFetchConfig"') is not null as has_cloud_fetch_config,
        to_regclass('"CloudLanguageLibrary"') is not null as has_cloud_language_library,
        to_regclass('"CloudSourceSubmission"') is not null as has_cloud_source_submission,
        to_regclass('"CloudSourceTask"') is not null as has_cloud_source_task,
        to_regclass('"CloudFetchQueueItem"') is not null as has_cloud_fetch_queue_item,
        to_regclass('"CloudFetchRun"') is not null as has_cloud_fetch_run,
        to_regclass('"CloudFetchRunTask"') is not null as has_cloud_fetch_run_task,
        to_regclass('"CloudFetchQueueItem_active_task_key"') is not null as has_queue_active_task_index
    `);

    const schemaChecks = [
      ["migration", schema.migration_applied, "Migration 000080_cloud_source_fetch has been applied."],
      ["table.config", schema.has_cloud_fetch_config, "CloudFetchConfig table exists."],
      ["table.language_library", schema.has_cloud_language_library, "CloudLanguageLibrary table exists."],
      ["table.submission", schema.has_cloud_source_submission, "CloudSourceSubmission table exists."],
      ["table.task", schema.has_cloud_source_task, "CloudSourceTask table exists."],
      ["table.queue", schema.has_cloud_fetch_queue_item, "CloudFetchQueueItem table exists."],
      ["table.run", schema.has_cloud_fetch_run, "CloudFetchRun table exists."],
      ["table.run_task", schema.has_cloud_fetch_run_task, "CloudFetchRunTask table exists."],
      ["index.active_queue", schema.has_queue_active_task_index, "Active queue uniqueness index exists."],
    ] as const;
    for (const [id, ok, message] of schemaChecks) {
      addCheck(checks, id, ok, message);
    }

    const schemaReady = schemaChecks.every(([, ok]) => ok);
    if (!schemaReady) {
      const result = { status: "not_ready" as const, checks };
      printResult(result);
      process.exitCode = 1;
      return;
    }

    const cloudLibraries = await prisma.cloudLanguageLibrary.findMany({
      orderBy: { summaryLanguage: "asc" },
      select: {
        summaryLanguage: true,
        enabled: true,
        ownerUserId: true,
        hubEntryId: true,
        owner: { select: { id: true } },
      },
    });
    const enabledLibraries = cloudLibraries.filter((library) => library.enabled);
    addCheck(
      checks,
      "cloud_language_libraries.enabled",
      enabledLibraries.length > 0,
      "At least one enabled cloud language library is configured.",
      { enabled: enabledLibraries.map((library) => library.summaryLanguage) },
    );

    for (const language of expectedLanguages) {
      const library = cloudLibraries.find((item) => item.summaryLanguage === language);
      addCheck(
        checks,
        `cloud_language_libraries.${language}`,
        Boolean(library?.enabled && library.owner?.id),
        `Cloud language library ${language} is enabled and has an owner user.`,
        library
          ? {
              enabled: library.enabled,
              ownerConfigured: Boolean(library.owner?.id),
              hubEntryConfigured: Boolean(library.hubEntryId),
            }
          : { configured: false },
      );
    }

    const adminUserCount = await prisma.user.count({
      where: {
        email: {
          in: adminEmails(),
          mode: "insensitive",
        },
      },
    });
    addCheck(
      checks,
      "admin_user",
      adminUserCount > 0,
      "At least one configured admin email exists as a user for cloud fetch API access.",
      { adminUserCount },
    );

    const queueStats = await prisma.$queryRawUnsafe<Array<{
      queued: number;
      leased: number;
      active_tasks: number;
    }>>(`
      select
        (select count(*)::int from "CloudFetchQueueItem" where status = 'QUEUED') as queued,
        (select count(*)::int from "CloudFetchQueueItem" where status = 'LEASED') as leased,
        (select count(*)::int from "CloudSourceTask" where status = 'ACTIVE') as active_tasks
    `);
    addCheck(checks, "cloud_queue.snapshot", true, "Current cloud queue snapshot collected.", queueStats[0]);
  } finally {
    await prisma.$disconnect();
  }

  const ready = checks.every((check) => check.ok);
  const result = { status: ready ? "ready" as const : "not_ready" as const, checks };
  printResult(result);
  if (!ready) process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  printResult({
    status: "not_ready",
    checks: [{ id: "unexpected_error", ok: false, message }],
  });
  process.exitCode = 1;
});
