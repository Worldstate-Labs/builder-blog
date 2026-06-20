export function resolveDigestHeadlineSummary({
  headlineSummary,
}: {
  headlineSummary: string | null;
}) {
  const stored = headlineSummary?.trim();
  if (stored) return stored;
  return null;
}
