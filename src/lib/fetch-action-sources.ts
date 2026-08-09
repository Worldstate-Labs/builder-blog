import { isPlatformMaintainedSourceType } from "@/lib/platform-maintained-sources";

type SourceTypeCarrier = {
  sourceType: string | null | undefined;
};

type FetchActionEligibilityOptions = {
  userIsAdmin?: boolean;
};

export function isFetchActionEligibleSource(
  source: SourceTypeCarrier,
  options: FetchActionEligibilityOptions = {},
) {
  return options.userIsAdmin || !isPlatformMaintainedSourceType(source.sourceType);
}

export function cloudSubmissionSourcesForBuilders<T extends SourceTypeCarrier>(
  builders: T[],
  options: FetchActionEligibilityOptions = {},
): T[] {
  return builders.filter((builder) => isFetchActionEligibleSource(builder, options));
}

export function hasFetchActionSourcesForBuilders(
  builders: SourceTypeCarrier[],
  options: FetchActionEligibilityOptions = {},
) {
  return builders.some((builder) => isFetchActionEligibleSource(builder, options));
}

export function fetchSyncSupportingCopy(
  hasFetchActionSources: boolean,
) {
  return hasFetchActionSources
    ? "Choose FollowBrief or your own agent to fetch and summarize sources."
    : null;
}
