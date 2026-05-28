import type { ComponentType } from "react";
import { FileText, Globe, Play, Podcast, Rss, X } from "lucide-react";

// Canonical mapping from source-type id to its lucide icon. Imported by
// SourceBadge (display chip on rows / detail headers) and the source-type
// picker in AddBuilderForm so the two stay in sync.
export const sourceIcons: Record<string, ComponentType<{ className?: string }>> = {
  blog: Rss,
  podcast: Podcast,
  pdf: FileText,
  website: Globe,
  x: X,
  youtube: Play,
};

export function sourceIconFor(id: string | null | undefined): ComponentType<{ className?: string }> {
  if (!id) return Globe;
  return sourceIcons[id] ?? Globe;
}
