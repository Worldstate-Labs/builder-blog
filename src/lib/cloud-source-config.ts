import { z } from "zod";
import { normalizeSummaryLanguagePreference } from "@/lib/language-preference";

export const CLOUD_FETCH_CONFIG_ID = "global";

export const DEFAULT_CLOUD_FETCH_CONFIG = {
  tokenBudgetPerHour: 1_000_000,
  leaseTtlMinutes: 60,
  schedulingLeadMinutes: 120,
  retryBaseMinutes: 30,
  starvationReserveRatio: 0.15,
  failureCircuitBreakerThreshold: 5,
  canonicalCooldownMinutes: 60,
  durationColdStartBufferRatio: 0.5,
};

const CloudFetchConfigPatchSchema = z.object({
  tokenBudgetPerHour: z.number().int().min(1_000).max(100_000_000).optional(),
  leaseTtlMinutes: z.number().int().min(5).max(240).optional(),
  schedulingLeadMinutes: z.number().int().min(0).max(1_440).optional(),
  retryBaseMinutes: z.number().int().min(5).max(720).optional(),
  starvationReserveRatio: z.number().min(0).max(0.5).optional(),
  failureCircuitBreakerThreshold: z.number().int().min(1).max(50).optional(),
  canonicalCooldownMinutes: z.number().int().min(0).max(1_440).optional(),
  durationColdStartBufferRatio: z.number().min(0).max(2).optional(),
}).strict();

const CloudLanguageLibraryPatchSchema = z.object({
  summaryLanguage: z.string().min(1).max(40),
  enabled: z.boolean().optional(),
}).strict();

export function normalizeCloudFetchConfigPatchInput(input: unknown) {
  return CloudFetchConfigPatchSchema.parse(input);
}

export function normalizeCloudLanguageLibraryPatchInput(input: unknown) {
  const parsed = CloudLanguageLibraryPatchSchema.parse(input);
  const summaryLanguage = normalizeSummaryLanguagePreference(parsed.summaryLanguage);
  return {
    summaryLanguage,
    enabled: parsed.enabled ?? true,
  };
}

export function serializeCloudFetchConfig(stored: Partial<typeof DEFAULT_CLOUD_FETCH_CONFIG> | null) {
  return {
    ...DEFAULT_CLOUD_FETCH_CONFIG,
    ...(stored ?? {}),
  };
}
