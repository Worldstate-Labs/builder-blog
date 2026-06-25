export type SourceCandidate = {
  id: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  avatarDataUrl?: string | null;
};

export function sourceCandidateValue(candidate: SourceCandidate) {
  if (candidate.sourceType === "x" && candidate.handle) return `@${candidate.handle}`;
  return candidate.sourceUrl ?? candidate.fetchUrl ?? candidate.handle ?? "";
}

export function sourceCandidateMatches(candidate: SourceCandidate, query: string) {
  const normalizedQuery = normalizeCandidateText(query);
  if (!normalizedQuery) return false;
  return [
    candidate.name,
    candidate.sourceType,
    candidate.sourceUrl,
    candidate.fetchUrl,
    candidate.handle,
    sourceCandidateValue(candidate),
  ].some((value) => normalizeCandidateText(value).includes(normalizedQuery));
}

function normalizeCandidateText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^@/, "");
}
