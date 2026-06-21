export const TERMINAL_FETCH_TASK_STATUSES = new Set(["synced", "skipped", "failed", "action_needed"]);

type FetchRunTask = Record<string, unknown>;

export type FetchRunPlannedTaskPatch = {
  id: string;
} & FetchRunTask;

export type FetchRunTaskOutcomePatch = {
  fetchTaskId: string;
  plannedTask?: FetchRunTask;
} & FetchRunTask;

export type MergeFetchRunDetailsInput = {
  plannedTasks?: FetchRunPlannedTaskPatch[];
  taskOutcomes?: FetchRunTaskOutcomePatch[];
};

export type MergeFetchRunDetailsResult = {
  details: Record<string, unknown>;
  matched: number;
  planned: number;
};

function taskRecord(value: unknown): FetchRunTask {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as FetchRunTask) }
    : {};
}

function taskStatus(task: FetchRunTask): string | null {
  return typeof task.status === "string" ? task.status : null;
}

function normalizePlannedTask(task: FetchRunTask): FetchRunTask {
  return {
    ...task,
    status: typeof task.status === "string" ? task.status : "pending",
  };
}

function mergePlannedTask(existing: FetchRunTask, planned: FetchRunTask): FetchRunTask {
  const normalized = normalizePlannedTask(planned);
  const merged = { ...existing };
  for (const [key, value] of Object.entries(normalized)) {
    if (key === "status" || value === undefined) continue;
    if (value === null && merged[key] !== undefined && merged[key] !== null) continue;
    merged[key] = value;
  }

  const previousStatus = taskStatus(existing);
  const incomingStatus = taskStatus(normalized);
  if (previousStatus && TERMINAL_FETCH_TASK_STATUSES.has(previousStatus)) {
    merged.status = previousStatus;
  } else if (previousStatus && previousStatus !== "pending" && incomingStatus === "pending") {
    merged.status = previousStatus;
  } else {
    merged.status = incomingStatus ?? previousStatus ?? "pending";
  }
  return merged;
}

function outcomePatch(outcome: FetchRunTaskOutcomePatch): FetchRunTask {
  const patch: FetchRunTask = {};
  for (const [key, value] of Object.entries(outcome)) {
    if (key === "fetchTaskId" || key === "plannedTask" || value === undefined) continue;
    patch[key] = value;
  }
  return patch;
}

function mergeOutcomeTask(existing: FetchRunTask, outcome: FetchRunTaskOutcomePatch): FetchRunTask {
  const previousStatus = taskStatus(existing);
  const incomingStatus = typeof outcome.status === "string" ? outcome.status : null;
  if (previousStatus === "synced" && incomingStatus && incomingStatus !== "synced") {
    return existing;
  }
  return { ...existing, ...outcomePatch(outcome) };
}

function builderIdsFromDetails(details: Record<string, unknown>): Set<string> {
  return new Set(
    (Array.isArray(details.perBuilder) ? details.perBuilder : [])
      .map((builder) =>
        builder && typeof builder === "object"
          ? (builder as Record<string, unknown>).builderId
          : null,
      )
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
}

export function mergeFetchRunDetails(
  existingDetails: unknown,
  { plannedTasks = [], taskOutcomes = [] }: MergeFetchRunDetailsInput,
): MergeFetchRunDetailsResult {
  const details =
    existingDetails && typeof existingDetails === "object" && !Array.isArray(existingDetails)
      ? { ...(existingDetails as Record<string, unknown>) }
      : {};
  const byTaskId = new Map(taskOutcomes.map((outcome) => [outcome.fetchTaskId, outcome]));
  const plannedTaskById = new Map(plannedTasks.map((task) => [task.id, task]));
  const legacyPlannedTaskById = new Map(
    taskOutcomes
      .filter((outcome) => outcome.plannedTask && typeof outcome.plannedTask === "object")
      .map((outcome) => [outcome.fetchTaskId, outcome.plannedTask as FetchRunTask]),
  );

  const existingTasks = Array.isArray(details.fetchTasks) ? details.fetchTasks : [];
  const plannedBuilderIds = builderIdsFromDetails(details);
  const builderAllowed = (plannedTask: FetchRunTask) => {
    const plannedBuilderId = plannedTask.builderId;
    return (
      plannedBuilderIds.size === 0 ||
      (typeof plannedBuilderId === "string" && plannedBuilderIds.has(plannedBuilderId))
    );
  };

  let planned = 0;
  const existingIds = new Set<string>();
  let mergedTasks = existingTasks.map((task) => {
    const currentTask = taskRecord(task);
    const id = typeof currentTask.id === "string" ? currentTask.id : "";
    if (!id) return task;
    existingIds.add(id);
    const plannedTask = plannedTaskById.get(id);
    if (!plannedTask) return task;
    planned += 1;
    return mergePlannedTask(currentTask, plannedTask);
  });

  for (const plannedTask of plannedTasks) {
    if (existingIds.has(plannedTask.id)) continue;
    if (!builderAllowed(plannedTask)) continue;
    mergedTasks.push(normalizePlannedTask(plannedTask));
    existingIds.add(plannedTask.id);
    planned += 1;
  }

  let matched = 0;
  mergedTasks = mergedTasks.map((task) => {
    const currentTask = taskRecord(task);
    const id = typeof currentTask.id === "string" ? currentTask.id : "";
    const outcome = id ? byTaskId.get(id) : undefined;
    if (!outcome) return task;
    matched += 1;
    return mergeOutcomeTask(currentTask, outcome);
  });

  for (const outcome of taskOutcomes) {
    if (existingIds.has(outcome.fetchTaskId)) continue;
    const plannedTask = legacyPlannedTaskById.get(outcome.fetchTaskId);
    if (!plannedTask) continue;
    const plannedTaskWithId = { ...plannedTask, id: plannedTask.id ?? outcome.fetchTaskId };
    if (!builderAllowed(plannedTaskWithId)) continue;
    mergedTasks.push({
      ...normalizePlannedTask(plannedTaskWithId),
      ...outcomePatch(outcome),
    });
    existingIds.add(outcome.fetchTaskId);
  }
  details.fetchTasks = mergedTasks;

  const uniq = (vals: unknown[]) => [
    ...new Set(vals.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)),
  ];
  const models = uniq(taskOutcomes.map((outcome) => outcome.agentModel));
  const runtimes = uniq(taskOutcomes.map((outcome) => outcome.agentRuntime));
  if (models.length) details.agentModel = models.length === 1 ? models[0] : models.join(" / ");
  if (runtimes.length) {
    details.agentRuntime = runtimes.length === 1 ? runtimes[0] : runtimes.join(" / ");
  }

  return { details, matched, planned };
}
