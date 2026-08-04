export const GLOBAL_RESET_FENCE_ID = "global";

const RESET_FENCE_EPOCH = new Date(0);

type ResetFenceClient = {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  resetFence: {
    upsert?(args: unknown): Promise<{ lastResetAt: Date }>;
    update(args: unknown): Promise<{ lastResetAt: Date }>;
  };
};

export function userResetFenceId(userId: string) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("A user ID is required for a personal reset fence.");
  return `user:${normalizedUserId}`;
}

export class StaleWorkerWriteError extends Error {
  readonly statusCode = 409;
  readonly responseCode = "agent_job_reset_fenced";
  readonly retryable = false;

  constructor() {
    super("This worker started before the latest reset. Start a new run.");
    this.name = "StaleWorkerWriteError";
  }
}

export async function lockResetFenceForWorker(
  client: ResetFenceClient,
  startedAt: Date,
  fenceId = GLOBAL_RESET_FENCE_ID,
) {
  const lastResetAt = await lockResetFenceForNewWorker(client, fenceId);
  if (startedAt.getTime() <= lastResetAt.getTime()) {
    throw new StaleWorkerWriteError();
  }
  return lastResetAt;
}

export async function lockResetFenceForNewWorker(
  client: ResetFenceClient,
  fenceId = GLOBAL_RESET_FENCE_ID,
) {
  await ensureResetFenceExists(client, fenceId);
  const rows = await client.$queryRawUnsafe(
    'SELECT "lastResetAt" FROM "ResetFence" WHERE "id" = $1 FOR SHARE',
    fenceId,
  ) as Array<{ lastResetAt: Date }>;
  const lastResetAt = rows[0]?.lastResetAt;
  if (!lastResetAt) {
    throw new Error(`Reset fence ${fenceId} is not initialized.`);
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
  fenceId = GLOBAL_RESET_FENCE_ID,
) {
  await ensureResetFenceExists(client, fenceId);
  await client.$queryRawUnsafe(
    'SELECT "id" FROM "ResetFence" WHERE "id" = $1 FOR UPDATE',
    fenceId,
  );
  const lastResetAt = await databaseClockNow(client);
  const fence = await client.resetFence.update({
    where: { id: fenceId },
    data: { lastResetAt },
    select: { lastResetAt: true },
  });
  return fence.lastResetAt;
}

async function ensureResetFenceExists(
  client: ResetFenceClient,
  fenceId: string,
) {
  if (fenceId === GLOBAL_RESET_FENCE_ID) return;
  if (!client.resetFence.upsert) {
    throw new Error(`Reset fence ${fenceId} cannot be initialized.`);
  }
  await client.resetFence.upsert({
    where: { id: fenceId },
    create: { id: fenceId, lastResetAt: RESET_FENCE_EPOCH },
    update: {},
    select: { lastResetAt: true },
  });
}
