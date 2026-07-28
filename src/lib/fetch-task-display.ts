export function fetchTaskDisplayLabel(task: {
  id?: string | null;
  title?: string | null;
  url?: string | null;
}) {
  const title = clean(task.title);
  if (title) return title;
  const url = compactUrl(task.url);
  if (url) return url;

  const id = clean(task.id) ?? "";
  const parts = id.split(":");
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const decodedUrl = compactUrl(decode(parts[index] ?? ""));
    if (decodedUrl) return decodedUrl;
  }
  const shortId = id.replace(/[^a-z0-9]/gi, "").slice(-8);
  return shortId ? `Post ${shortId}` : "Post";
}

function compactUrl(value: unknown) {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./i, "");
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${path}`.slice(0, 120);
  } catch {
    return null;
  }
}

function decode(value: string) {
  let decoded = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
