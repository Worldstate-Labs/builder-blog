import type { MetadataRoute } from "next";
import { publicSiteOrigin } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: publicSiteOrigin, changeFrequency: "weekly", priority: 1 },
    { url: `${publicSiteOrigin}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${publicSiteOrigin}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
