export function canonicalFetchTaskId(value: unknown): string {
  const id = String(value ?? "").trim();
  const match = id.match(/^(fetch_post:[^:]+:[^:]+:)([\s\S]*)$/);
  if (!match) return id;

  const [, prefix, externalId] = match;
  try {
    return `${prefix}${encodeURIComponent(decodeURIComponent(externalId))}`;
  } catch {
    return `${prefix}${encodeURIComponent(externalId)}`;
  }
}
