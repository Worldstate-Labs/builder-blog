export function normalizeLegacyReturnTo(value: string) {
  if (value.startsWith("/recommendations")) return "/dashboard?tab=following";
  if (value.startsWith("/history")) return "/dashboard?tab=ai-digest";
  return value;
}
