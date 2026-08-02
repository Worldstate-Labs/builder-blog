import { isPlatformMaintainedSourceType } from "@/lib/platform-maintained-sources";

type SourceTypeCarrier = {
  sourceType: string | null | undefined;
};

export function isFetchActionEligibleSource(
  source: SourceTypeCarrier,
) {
  return !isPlatformMaintainedSourceType(source.sourceType);
}

export function cloudSubmissionSourcesForBuilders<T extends SourceTypeCarrier>(
  builders: T[],
): T[] {
  return builders.filter((builder) => isFetchActionEligibleSource(builder));
}

export function hasFetchActionSourcesForBuilders(
  builders: SourceTypeCarrier[],
) {
  return builders.some((builder) => isFetchActionEligibleSource(builder));
}

export function fetchSyncSupportingCopy(
  hasFetchActionSources: boolean,
) {
  return hasFetchActionSources
    ? "Choose FollowBrief or your own agent to fetch and summarize sources."
    : null;
}
