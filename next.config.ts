import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
  turbopack: {
    root: __dirname,
  },
  outputFileTracingIncludes: {
    "/api/skill/files/[file]": [
      "./scripts/builder-digest.mjs",
      "./scripts/builder-agent-runner.sh",
      "./skills/builder-blog-digest/SKILL.md",
      "./skills/builder-blog-digest/jobs/library-once.md",
      "./skills/builder-blog-digest/jobs/digest-once.md",
      "./skills/builder-blog-digest/jobs/library-cron-setup.md",
      "./skills/builder-blog-digest/jobs/digest-cron-setup.md",
      "./skills/builder-blog-digest/jobs/library-cron.md",
      "./skills/builder-blog-digest/jobs/digest-cron.md",
    ],
  },
};

export default nextConfig;
