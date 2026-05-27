import type { ComponentType } from "react";
import { FileText, Globe, Podcast, Rss, X, Play } from "lucide-react";

type SourceBadgeBuilder = {
  kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
  sourceType?: string | null;
  sourceUrl?: string | null;
  fetchUrl?: string | null;
};

const sourceIcons: Record<string, ComponentType<{ className?: string }>> = {
  blog: Rss,
  podcast: Podcast,
  pdf: FileText,
  website: Globe,
  x: X,
  youtube: Play,
};

export function SourceBadge({
  builder,
  sourceType,
  showLabel = true,
}: {
  builder?: SourceBadgeBuilder | null;
  sourceType?: string | null;
  showLabel?: boolean;
}) {
  const source = builder ? sourceDisplayForBuilder(builder) : sourceDisplayForType(sourceType);
  const Icon = sourceIcons[source.id] ?? Globe;

  return (
    <span className="source-badge" data-source={source.id} title={source.label}>
      <span className="source-badge-mark" aria-hidden="true">
        <Icon className="h-3.5 w-3.5" />
      </span>
      {showLabel ? <span>{source.label}</span> : null}
    </span>
  );
}

function sourceDisplayForBuilder(builder: SourceBadgeBuilder) {
  const explicit = normalizeSourceType(builder.sourceType);
  if (explicit) return sourceDisplayForType(explicit);
  if (
    builder.kind === "PODCAST" &&
    /youtube\.com|youtu\.be/i.test(`${builder.sourceUrl ?? ""} ${builder.fetchUrl ?? ""}`)
  ) {
    return sourceDisplayForType("youtube");
  }
  if (builder.kind === "X") return sourceDisplayForType("x");
  if (builder.kind === "BLOG") return sourceDisplayForType("blog");
  if (builder.kind === "PODCAST") return sourceDisplayForType("podcast");
  return sourceDisplayForType("website");
}

function sourceDisplayForType(sourceType: string | null | undefined) {
  const id = normalizeSourceType(sourceType) || "website";
  const labels: Record<string, string> = {
    blog: "Blog",
    podcast: "Podcast RSS",
    pdf: "PDF",
    website: "Website",
    x: "X / Twitter",
    youtube: "YouTube",
  };
  return {
    id,
    label: labels[id] ?? titleCase(id),
  };
}

function normalizeSourceType(sourceType: string | null | undefined) {
  const normalized = sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized && normalized !== "auto" ? normalized : "";
}

function titleCase(value: string) {
  const label = value.toLowerCase().replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
