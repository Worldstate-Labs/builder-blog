import { normalizeSummaryLanguagePreference } from "@/lib/language-preference";
import { z } from "zod";
import { SkillBuilderSchema, SkillTaskOutcomeSchema } from "@/lib/skill-contracts";
import type {
  CloudDeadlineState,
  CloudShardBudgetReason,
  CloudShardWorkloadClass,
} from "@/lib/local-agent-timeouts";

export type CloudFetchFrequencyInput = "day" | "week";
export type CloudFetchFrequency = "DAILY" | "WEEKLY";
export const CLOUD_SOURCE_SUBMISSION_LIMIT = 30;

export type CloudSourceSubmissionInput = {
  frequency: string;
  summaryLanguage: string | null | undefined;
  builderIds?: unknown;
};

export type NormalizedCloudSourceSubmission = {
  frequency: CloudFetchFrequency;
  summaryLanguage: string;
  builderIds?: string[];
};

export type CloudFetchExecutionPlan = {
  mustSucceedBy: string;
  estimatedDurationSeconds: number;
  provisionalExecutionBudgetSeconds: number;
  workloadClass: CloudShardWorkloadClass;
  budgetReason: CloudShardBudgetReason;
  deadlineState: CloudDeadlineState;
};

export function normalizeCloudFetchFrequencyInput(value: string): CloudFetchFrequency {
  const normalized = value.trim().toLowerCase();
  if (normalized === "day") return "DAILY";
  if (normalized === "week") return "WEEKLY";
  throw new Error("Cloud fetch frequency must be day or week.");
}

function normalizeCloudSubmissionBuilderIds(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("Cloud source selections must be an array.");
  }
  const ids = Array.from(
    new Set(
      value.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean),
    ),
  );
  if (ids.length > CLOUD_SOURCE_SUBMISSION_LIMIT) {
    throw new Error(`Cloud submissions can include at most ${CLOUD_SOURCE_SUBMISSION_LIMIT} sources.`);
  }
  return ids;
}

export function normalizeCloudSourceSubmissionInput(
  input: CloudSourceSubmissionInput,
): NormalizedCloudSourceSubmission {
  const summaryLanguage = normalizeSummaryLanguagePreference(input.summaryLanguage);
  const builderIds = normalizeCloudSubmissionBuilderIds(input.builderIds);
  return {
    frequency: normalizeCloudFetchFrequencyInput(input.frequency),
    summaryLanguage,
    ...(builderIds === undefined ? {} : { builderIds }),
  };
}

const CloudFetchSyncTaskResultSchema = z.object({
  cloudSourceTaskId: z.string().min(1).max(64),
  status: z.enum(["succeeded", "partial", "failed"]),
  plannedPosts: z.number().int().min(0).max(10_000),
  syncedPosts: z.number().int().min(0).max(10_000),
  failedPosts: z.number().int().min(0).max(10_000),
  actualDurationSeconds: z.number().int().positive().max(24 * 60 * 60).nullable().optional(),
  failureReason: z.string().trim().min(1).max(400).nullable().optional(),
  usageTokens: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  usageCostUsd: z.number().min(0).max(1_000_000).nullable().optional(),
  details: z.record(z.string(), z.unknown()).default({}),
}).superRefine((result, ctx) => {
  if ((result.status === "failed" || result.status === "partial") && !result.failureReason?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["failureReason"],
      message: "Failed cloud task results require a failure reason.",
    });
  }
  if (result.syncedPosts + result.failedPosts > result.plannedPosts) {
    ctx.addIssue({
      code: "custom",
      path: ["plannedPosts"],
      message: "Synced and failed posts cannot exceed planned posts.",
    });
  }
});

const CloudFetchSyncPayloadSchema = z.object({
  cloudRunId: z.string().min(1).max(64),
  force: z.boolean().default(false),
  fetchTool: z.string().min(1).max(160).default("Cloud Agent sync"),
  summaryLanguage: z.string().max(40).nullable().optional(),
  builders: z.array(SkillBuilderSchema).max(50).default([]),
  taskOutcomes: z.array(SkillTaskOutcomeSchema).max(500).default([]),
  taskResults: z.array(CloudFetchSyncTaskResultSchema).min(1).max(500),
});

const CloudFetchPlanPostSchema = z.object({
  postTaskId: z.string().min(1).max(500),
  estimatedWorkSeconds: z.number().int().min(0).max(7 * 24 * 60 * 60),
  executionBudgetSeconds: z.number().int().min(60 * 60).max(4 * 60 * 60),
  workloadClass: z.enum(["standard", "long_media"]),
  budgetReason: z.enum([
    "minimum_budget",
    "scaled_and_rounded",
    "capped_standard_maximum",
    "capped_long_media_maximum",
  ]),
  deadlineState: z.enum(["on_time", "at_risk", "missed"]),
  mediaDurationSeconds: z.number().int().min(0).max(7 * 24 * 60 * 60).nullable().optional(),
  estimateEvidence: z.record(z.string(), z.unknown()).nullable().optional(),
  captionAvailability: z.string().trim().min(1).max(120).nullable().optional(),
  plannedExtractionMethod: z.string().trim().min(1).max(160).nullable().optional(),
  mustSucceedBy: z.string().datetime({ offset: true }).max(40).nullable().optional(),
});

const CloudFetchPlanGroupSchema = z.object({
  cloudSourceTaskId: z.string().min(1).max(64),
  posts: z.array(CloudFetchPlanPostSchema).min(1).max(500),
}).superRefine((group, ctx) => {
  const seenPostIds = new Set<string>();
  for (const post of group.posts) {
    if (seenPostIds.has(post.postTaskId)) {
      ctx.addIssue({
        code: "custom",
        path: ["posts"],
        message: "Task plans cannot repeat the same postTaskId within a cloud source task.",
      });
      break;
    }
    seenPostIds.add(post.postTaskId);
  }
});

const CloudFetchPlanPatchPayloadSchema = z.object({
  runId: z.string().min(1).max(64),
  plans: z.array(CloudFetchPlanGroupSchema).min(1).max(500),
}).superRefine((payload, ctx) => {
  const seenSourceTaskIds = new Set<string>();
  for (const plan of payload.plans) {
    if (seenSourceTaskIds.has(plan.cloudSourceTaskId)) {
      ctx.addIssue({
        code: "custom",
        path: ["plans"],
        message: "Task plans cannot repeat the same cloudSourceTaskId.",
      });
      break;
    }
    seenSourceTaskIds.add(plan.cloudSourceTaskId);
  }
});

export function parseCloudFetchSyncPayload(payload: unknown) {
  return CloudFetchSyncPayloadSchema.safeParse(payload);
}

export function parseCloudFetchPlanPatchPayload(payload: unknown) {
  return CloudFetchPlanPatchPayloadSchema.safeParse(payload);
}
