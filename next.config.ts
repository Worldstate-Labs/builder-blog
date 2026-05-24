import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  outputFileTracingIncludes: {
    "/api/skill/files/[file]": [
      "./scripts/builder-digest.mjs",
      "./skills/builder-blog-digest/SKILL.md",
    ],
  },
};

export default nextConfig;
