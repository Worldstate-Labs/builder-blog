export type LockedCloudFetchRunTaskRow = {
  cloudSourceTaskId: string;
  status: string;
  details?: unknown;
};

type CloudFetchRunTaskLockClient = {
  $queryRawUnsafe(
    query: string,
    ...values: unknown[]
  ): Promise<LockedCloudFetchRunTaskRow[]>;
};

export async function lockCloudFetchRunTaskRows(
  client: CloudFetchRunTaskLockClient,
  params: { runId: string; cloudSourceTaskIds: string[] },
) {
  const cloudSourceTaskIds = Array.from(
    new Set(
      params.cloudSourceTaskIds
        .map((taskId) => String(taskId || "").trim())
        .filter(Boolean),
    ),
  );
  if (cloudSourceTaskIds.length === 0) return [];

  const placeholders = cloudSourceTaskIds.map((_, index) => `$${index + 2}`).join(", ");
  return client.$queryRawUnsafe(
    `SELECT "cloudSourceTaskId", "status", "details"
     FROM "CloudFetchRunTask"
     WHERE "runId" = $1
       AND "cloudSourceTaskId" IN (${placeholders})
     FOR UPDATE`,
    params.runId,
    ...cloudSourceTaskIds,
  );
}
