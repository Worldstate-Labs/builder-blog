import { z } from "zod";
import {
  isOriginalContentLanguagePreference,
  normalizeSummaryLanguagePreference,
} from "@/lib/language-preference";

export const CLOUD_FETCH_CONFIG_ID = "global";

export const DEFAULT_CLOUD_FETCH_CONFIG = {
  maxTasksPerHour: 20,
  maxActiveLeases: 20,
  workerSecondsPerHour: 3600,
  defaultBatchSize: 10,
  leaseTtlMinutes: 60,
  schedulingLeadMinutes: 120,
  planningHorizonHours: 48,
  retryBaseMinutes: 30,
  starvationReserveRatio: 0.15,
  retryReserveRatio: 0.1,
  failureCircuitBreakerThreshold: 5,
  canonicalCooldownMinutes: 60,
  durationColdStartBufferRatio: 0.5,
};

const CloudFetchConfigPatchSchema = z.object({
  maxTasksPerHour: z.number().int().min(1).max(500).optional(),
  maxActiveLeases: z.number().int().min(1).max(500).optional(),
  workerSecondsPerHour: z.number().int().min(60).max(86_400).optional(),
  defaultBatchSize: z.number().int().min(1).max(100).optional(),
  leaseTtlMinutes: z.number().int().min(5).max(240).optional(),
  schedulingLeadMinutes: z.number().int().min(0).max(1_440).optional(),
  planningHorizonHours: z.number().int().min(1).max(168).optional(),
  retryBaseMinutes: z.number().int().min(5).max(720).optional(),
  starvationReserveRatio: z.number().min(0).max(0.5).optional(),
  retryReserveRatio: z.number().min(0).max(0.5).optional(),
  failureCircuitBreakerThreshold: z.number().int().min(1).max(50).optional(),
  canonicalCooldownMinutes: z.number().int().min(0).max(1_440).optional(),
  durationColdStartBufferRatio: z.number().min(0).max(2).optional(),
}).strict();

const CloudLanguageLibraryPatchSchema = z.object({
  summaryLanguage: z.string().min(1).max(40),
  ownerUserId: z.preprocess(
    trimOptionalString,
    z.string().min(1).max(64).nullable().optional(),
  ),
  ownerEmail: z.preprocess(
    trimOptionalString,
    z.string().email().max(320).nullable().optional(),
  ),
  enabled: z.boolean().optional(),
}).strict().superRefine((input, ctx) => {
  if (!input.ownerUserId?.trim() && !input.ownerEmail?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["ownerUserId"],
      message: "Cloud language library patch requires ownerUserId or ownerEmail.",
    });
  }
});

export function normalizeCloudFetchConfigPatchInput(input: unknown) {
  return CloudFetchConfigPatchSchema.parse(input);
}

function trimOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}

export function normalizeCloudLanguageLibraryPatchInput(input: unknown) {
  const parsed = CloudLanguageLibraryPatchSchema.parse(input);
  const summaryLanguage = normalizeSummaryLanguagePreference(parsed.summaryLanguage);
  if (isOriginalContentLanguagePreference(summaryLanguage)) {
    throw new Error("Cloud language libraries require a fixed summary language.");
  }
  return {
    summaryLanguage,
    ownerEmail: parsed.ownerEmail?.trim() || null,
    ownerUserId: parsed.ownerUserId?.trim() || null,
    enabled: parsed.enabled ?? true,
  };
}

export function serializeCloudFetchConfig(stored: Partial<typeof DEFAULT_CLOUD_FETCH_CONFIG> | null) {
  return {
    ...DEFAULT_CLOUD_FETCH_CONFIG,
    ...(stored ?? {}),
  };
}
