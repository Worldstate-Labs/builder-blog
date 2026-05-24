import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  outputFileTracingIncludes: {
    "/api/skill/files/[file]": [
      "./scripts/builder-digest.mjs",
      "./scripts/builder-agent-runner.sh",
      "./skills/builder-blog-digest/SKILL.md",
      "./skills/builder-blog-digest/jobs/library-cron.md",
      "./skills/builder-blog-digest/jobs/digest-cron.md",
    ],
  },
};

export default nextConfig;
