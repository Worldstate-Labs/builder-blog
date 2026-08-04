import type { UserFetchDigestResetSummary } from "@/lib/fetch-digest-reset";

export function generatedDataResetSummary(
  summary: UserFetchDigestResetSummary | null | undefined,
) {
  if (!summary) return "Generated data reset.";
  const logCount =
    summary.deletedLibraryFetchRuns +
    summary.deletedDigestRuns +
    summary.deletedAgentJobRuns;
  return [
    `Reset ${summary.resetBuilders} sources.`,
    `Deleted ${summary.deletedFeedItems} posts, ${summary.deletedDigests} briefs, and ${logCount} logs.`,
  ].join(" ");
}
