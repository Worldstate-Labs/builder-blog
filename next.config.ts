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
      // Shared fragments pulled in via {{INCLUDE:...}} by the library and
      // digest job prompts; must be bundled or expandSkillIncludes 500s.
      "./skills/builder-blog-digest/jobs/_fetch-task-contract.md",
      "./skills/builder-blog-digest/jobs/_digest-task-contract.md",
    ],
    // The jobs/skill.md route also expands {{INCLUDE:...}}, so it needs
    // the fragment (and the job prompts it serves) bundled too.
    "/api/skill/jobs/[job]/skill.md": [
      "./skills/builder-blog-digest/jobs/_fetch-task-contract.md",
      "./skills/builder-blog-digest/jobs/_digest-task-contract.md",
      "./skills/builder-blog-digest/jobs/library-once.md",
      "./skills/builder-blog-digest/jobs/digest-once.md",
      "./skills/builder-blog-digest/jobs/library-cron-setup.md",
      "./skills/builder-blog-digest/jobs/digest-cron-setup.md",
      "./skills/builder-blog-digest/jobs/library-cron.md",
      "./skills/builder-blog-digest/jobs/digest-cron.md",
      // Stop prompt is served by this route too; without it Vercel omits the
      // file from the bundle and the route 500s (ENOENT) in production.
      "./skills/builder-blog-digest/jobs/library-cron-stop.md",
    ],
  },
};

export default nextConfig;
