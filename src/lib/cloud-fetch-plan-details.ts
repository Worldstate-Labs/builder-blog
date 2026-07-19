type JsonRecord = Record<string, unknown>;

export type CloudFetchExecutionPlanPostPatch = {
  postTaskId: string;
  estimatedWorkSeconds: number;
  executionBudgetSeconds: number;
  workloadClass: string;
  budgetReason: string;
  deadlineState: string;
  mediaDurationSeconds?: number | null;
  estimateEvidence?: JsonRecord | null;
  captionAvailability?: string | null;
  plannedExtractionMethod?: string | null;
  mustSucceedBy?: string | null;
};

export type CloudFetchExecutionPlanPatchGroup = {
  cloudSourceTaskId: string;
  posts: CloudFetchExecutionPlanPostPatch[];
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as JsonRecord) }
    : {};
}

function mergeExecutionPlanRecords(existingPlan: unknown, nextPlan: unknown) {
  const existing = asRecord(existingPlan);
  const next = asRecord(nextPlan);
  const existingPosts = asRecord(existing.posts);
  const nextPosts = asRecord(next.posts);
  const posts = { ...existingPosts, ...nextPosts };
  return {
    ...existing,
    ...next,
    ...(Object.keys(posts).length > 0 ? { posts } : {}),
  };
}

export function mergeCloudFetchExecutionPlanDetails(
  existingDetails: unknown,
  plan: CloudFetchExecutionPlanPatchGroup,
) {
  const details = asRecord(existingDetails);
  const executionPlan = asRecord(details.executionPlan);
  const existingPosts = asRecord(executionPlan.posts);
  const nextPosts = { ...existingPosts };

  for (const post of plan.posts) {
    nextPosts[post.postTaskId] = {
      ...asRecord(existingPosts[post.postTaskId]),
      ...post,
    };
  }

  return {
    ...details,
    executionPlan: {
      ...executionPlan,
      posts: nextPosts,
    },
  };
}

export function mergeCloudFetchRunTaskDetails(existingDetails: unknown, nextDetails: unknown) {
  const existing = asRecord(existingDetails);
  const next = asRecord(nextDetails);
  if (Object.keys(existing).length === 0) return next;
  if (Object.keys(next).length === 0) return existing;

  return {
    ...existing,
    ...next,
    ...(existing.executionPlan !== undefined || next.executionPlan !== undefined
      ? {
          executionPlan: mergeExecutionPlanRecords(
            existing.executionPlan,
            next.executionPlan,
          ),
        }
      : {}),
  };
}
