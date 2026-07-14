const FETCH_TASK_STATUS_RANK: Record<string, number> = {
  planned: 10,
  fetched: 20,
  reading: 30,
  running: 30,
  summarizing: 40,
  summarized: 50,
  synced: 60,
  skipped: 60,
  failed: 60,
  action_needed: 60,
};

const SINGLETON_EVENT_TYPES = new Set(["tasks_planned"]);

function statusRank(value: unknown): number {
  return FETCH_TASK_STATUS_RANK[String(value ?? "")] ?? 0;
}

function eventIdentity(event: Record<string, unknown>): string {
  return JSON.stringify([
    event.type ?? "",
    event.message ?? "",
    event.taskId ?? "",
    event.builderId ?? "",
    event.status ?? "",
    event.reason ?? "",
  ]);
}

export function mergeFetchProgressTask(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const currentRank = statusRank(current.status);
  const incomingRank = statusRank(incoming.status);
  const incomingIsNewer = String(incoming.updatedAt ?? "") >= String(current.updatedAt ?? "");
  if (incomingRank > currentRank || (incomingRank === currentRank && incomingIsNewer)) {
    return { ...current, ...incoming };
  }

  return {
    ...current,
    ...incoming,
    status: current.status,
    phase: current.phase,
    message: current.message,
    reason: current.reason,
    updatedAt: current.updatedAt,
  };
}

export function dedupeFetchProgressEvents(
  values: Record<string, unknown>[],
  limit: number,
): Record<string, unknown>[] {
  const sorted = values.slice().sort((left, right) =>
    String(left.at ?? "").localeCompare(String(right.at ?? "")),
  );
  const exactKeys = new Set<string>();
  const singletonKeys = new Set<string>();
  const deduped: Record<string, unknown>[] = [];

  for (const event of sorted) {
    const identity = eventIdentity(event);
    const exactKey = JSON.stringify([event.at ?? "", identity]);
    if (exactKeys.has(exactKey)) continue;
    exactKeys.add(exactKey);

    if (SINGLETON_EVENT_TYPES.has(String(event.type ?? ""))) {
      if (singletonKeys.has(identity)) continue;
      singletonKeys.add(identity);
    }

    const previous = deduped.at(-1);
    if (previous && eventIdentity(previous) === identity) {
      deduped[deduped.length - 1] = event;
    } else {
      deduped.push(event);
    }
  }

  return deduped.slice(-limit);
}
