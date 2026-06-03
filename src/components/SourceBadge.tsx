import { Globe } from "lucide-react";
import { sourceIcons } from "@/lib/source-icons";

type SourceBadgeBuilder = {
  kind: "X" | "BLOG" | "PODCAST" | "WEBSITE";
  sourceType?: string | null;
  sourceUrl?: string | null;
  fetchUrl?: string | null;
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
  const base = builder ? sourceDisplayForBuilder(builder) : sourceDisplayForType(sourceType);
  // For podcast builders, derive a platform-specific label from the URL
  // so users see "Apple Podcasts" / "Spotify" / "小宇宙" instead of the
  // generic "Podcast RSS". Underlying sourceType is still `podcast` —
  // these platforms are all just directories over the same RSS feed.
  const source =
    builder && base.id === "podcast"
      ? { id: base.id, label: podcastPlatformLabel(builder) }
      : base;
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
    website: "Website",
    x: "X",
    youtube: "YouTube",
  };
  return {
    id,
    label: labels[id] ?? titleCase(id),
  };
}

function podcastPlatformLabel(builder: SourceBadgeBuilder) {
  const haystack = `${builder.sourceUrl ?? ""} ${builder.fetchUrl ?? ""}`.toLowerCase();
  if (haystack.includes("podcasts.apple.com")) return "Apple Podcasts";
  if (haystack.includes("open.spotify.com")) return "Spotify";
  if (haystack.includes("xiaoyuzhoufm.com")) return "小宇宙";
  if (haystack.includes("ximalaya.com")) return "喜马拉雅";
  if (haystack.includes("music.amazon")) return "Amazon Music";
  if (haystack.includes("overcast.fm")) return "Overcast";
  if (haystack.includes("pca.st") || haystack.includes("pocketcasts.com")) return "Pocket Casts";
  return "Podcast RSS";
}

function normalizeSourceType(sourceType: string | null | undefined) {
  const normalized = sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "pdf") return "website";
  return normalized && normalized !== "auto" ? normalized : "";
}

function titleCase(value: string) {
  const label = value.toLowerCase().replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
