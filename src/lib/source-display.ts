export function normalizeSourceType(sourceType: string | null | undefined) {
  const normalized = sourceType?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "pdf") return "website";
  return normalized && normalized !== "auto" ? normalized : "";
}

export function sourceDisplayForType(sourceType: string | null | undefined) {
  const id = normalizeSourceType(sourceType) || "website";
  return {
    id,
    label: sourceLabelForType(id),
  };
}

export function sourceLabelForType(sourceType: string | null | undefined) {
  const id = normalizeSourceType(sourceType) || "website";
  const labels: Record<string, string> = {
    blog: "Blog / Article Feed",
    github_trending: "GitHub Trending",
    podcast: "Podcast / Audio Feed",
    product_hunt_top_products: "Product Hunt Top Products",
    website: "Website",
    x: "X/Twitter",
    youtube: "YouTube",
  };
  return labels[id] ?? titleCase(id);
}

function titleCase(value: string) {
  const label = value.toLowerCase().replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
