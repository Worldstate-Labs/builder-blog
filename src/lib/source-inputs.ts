export const GITHUB_TRENDING_SOURCE_ID = "github_trending";
export const GITHUB_TRENDING_URL = "https://github.com/trending?since=daily";
export const PRODUCT_HUNT_TOP_PRODUCTS_SOURCE_ID = "product_hunt_top_products";
export const PRODUCT_HUNT_TOP_PRODUCTS_URL = "https://www.producthunt.com/";

export const FIXED_SOURCE_VALUE_BY_ID: Record<string, string> = {
  [GITHUB_TRENDING_SOURCE_ID]: GITHUB_TRENDING_URL,
  [PRODUCT_HUNT_TOP_PRODUCTS_SOURCE_ID]: PRODUCT_HUNT_TOP_PRODUCTS_URL,
};

const PLACEHOLDER_BY_SOURCE_ID: Record<string, string> = {
  x: "@deepmind or https://x.com/deepmind",
  blog: "https://example.com/blog or https://example.com/feed.xml",
  github_trending: GITHUB_TRENDING_URL,
  product_hunt_top_products: PRODUCT_HUNT_TOP_PRODUCTS_URL,
  youtube: "https://youtube.com/@deepmind",
  podcast: "Apple Podcasts URL or podcast RSS feed",
  website: "https://example.com",
};

export function placeholderForSourceId(sourceId: string): string {
  return PLACEHOLDER_BY_SOURCE_ID[sourceId] ?? "@handle or https://example.com/feed";
}
