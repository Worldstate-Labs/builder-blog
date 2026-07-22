import type { MetadataRoute } from "next";
import { publicSiteOrigin } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms"],
      disallow: [
        "/api/",
        "/builder/",
        "/builders",
        "/dashboard",
        "/history",
        "/library-hub",
        "/login",
        "/posts/",
        "/recommendations",
        "/search",
        "/settings",
      ],
    },
    sitemap: `${publicSiteOrigin}/sitemap.xml`,
    host: publicSiteOrigin,
  };
}
