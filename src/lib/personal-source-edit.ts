type SourceIdentityInput = {
  sourceType: string | null;
  sourceUrl: string | null;
  fetchUrl?: string | null;
  handle: string | null;
};

export function editableSourceIdentityChanged(
  existing: SourceIdentityInput,
  next: SourceIdentityInput,
) {
  if (normalizeSourceType(existing.sourceType) !== normalizeSourceType(next.sourceType)) {
    return true;
  }

  const existingHandle = normalizeIdentityHandle(existing.handle);
  const nextHandle = normalizeIdentityHandle(next.handle);
  if (existingHandle || nextHandle) {
    return existingHandle !== nextHandle;
  }

  return normalizeIdentityUrl(existing.sourceUrl) !== normalizeIdentityUrl(next.sourceUrl);
}

function normalizeSourceType(sourceType: string | null) {
  return sourceType?.trim().toLowerCase() ?? null;
}

function normalizeIdentityHandle(handle: string | null) {
  return handle?.trim().replace(/^@/, "").toLowerCase() || null;
}

function normalizeIdentityUrl(url: string | null) {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).toString();
  } catch {
    return trimmed;
  }
}
