const GLOBAL_RESET_FENCE_ID = "global";

type ResetFenceClient = {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  resetFence: {
    update(args: unknown): Promise<{ lastResetAt: Date }>;
  };
};

export class StaleWorkerWriteError extends Error {
  readonly statusCode = 409;

  constructor() {
    super("This worker started before the latest global reset. Start a new run.");
    this.name = "StaleWorkerWriteError";
  }
}

export async function lockResetFenceForWorker(
  client: ResetFenceClient,
  startedAt: Date,
) {
  const lastResetAt = await lockResetFenceForNewWorker(client);
  if (startedAt.getTime() <= lastResetAt.getTime()) {
    throw new StaleWorkerWriteError();
  }
  return lastResetAt;
}

export async function lockResetFenceForNewWorker(client: ResetFenceClient) {
  const rows = await client.$queryRawUnsafe(
    'SELECT "lastResetAt" FROM "ResetFence" WHERE "id" = $1 FOR SHARE',
    GLOBAL_RESET_FENCE_ID,
  ) as Array<{ lastResetAt: Date }>;
  const lastResetAt = rows[0]?.lastResetAt;
  if (!lastResetAt) {
    throw new Error("Global reset fence is not initialized.");
  }
  return lastResetAt;
}

export async function databaseClockNow(client: ResetFenceClient) {
  const rows = await client.$queryRawUnsafe(
    'SELECT clock_timestamp() AS "now"',
  ) as Array<{ now: Date }>;
  const now = rows[0]?.now;
  if (!now) throw new Error("Could not read the database clock.");
  return now;
}

export async function lockResetFenceForReset(
  client: ResetFenceClient,
) {
  await client.$queryRawUnsafe(
    'SELECT "id" FROM "ResetFence" WHERE "id" = $1 FOR UPDATE',
    GLOBAL_RESET_FENCE_ID,
  );
  const lastResetAt = await databaseClockNow(client);
  const fence = await client.resetFence.update({
    where: { id: GLOBAL_RESET_FENCE_ID },
    data: { lastResetAt },
    select: { lastResetAt: true },
  });
  return fence.lastResetAt;
}
