export function digestPreviewFromContent(content: string) {
  const text = content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^#{1,6}\s+/.test(line)) return false;
      if (/^AI Digest\b/i.test(line)) return false;
      if (/^(原文|source|link)[:：]/i.test(line)) return false;
      if (/^https?:\/\//i.test(line)) return false;
      return true;
    })
    .join(" ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;
  return text.length > 300 ? `${text.slice(0, 297).trimEnd()}...` : text;
}

export function resolveDigestHeadlineSummary({
  content,
  headlineSummary,
}: {
  content: string | null;
  headlineSummary: string | null;
}) {
  const stored = headlineSummary?.trim();
  if (stored) return stored;
  if (!content?.trim()) return null;
  return digestPreviewFromContent(content);
}
