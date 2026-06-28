import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https:",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
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
      "./config/local-agent-timeouts.json",
      "./skills/builder-blog-digest/jobs/library-once.md",
      "./skills/builder-blog-digest/jobs/digest-once.md",
      "./skills/builder-blog-digest/jobs/library-cron-setup.md",
      "./skills/builder-blog-digest/jobs/cloud-library-cron.md",
      "./skills/builder-blog-digest/jobs/digest-cron-setup.md",
      "./skills/builder-blog-digest/jobs/digest-cron.md",
      "./skills/builder-blog-digest/jobs/library-worker.md",
      "./skills/builder-blog-digest/jobs/library-discovery.md",
      // Shared fragments pulled in via {{INCLUDE:...}} by the library and
      // digest job prompts; must be bundled or expandSkillIncludes 500s.
      "./skills/builder-blog-digest/jobs/_fetch-task-discovery.md",
      "./skills/builder-blog-digest/jobs/_fetch-task-core.md",
      "./skills/builder-blog-digest/jobs/_fetch-task-syncing.md",
      "./skills/builder-blog-digest/jobs/_digest-task-contract.md",
    ],
    // The jobs/skill.md route also expands {{INCLUDE:...}}, so it needs
    // the fragment (and the job prompts it serves) bundled too.
    "/api/skill/jobs/[job]/skill.md": [
      "./skills/builder-blog-digest/jobs/_fetch-task-discovery.md",
      "./skills/builder-blog-digest/jobs/_fetch-task-core.md",
      "./skills/builder-blog-digest/jobs/_fetch-task-syncing.md",
      "./skills/builder-blog-digest/jobs/_digest-task-contract.md",
      "./skills/builder-blog-digest/jobs/library-once.md",
      "./skills/builder-blog-digest/jobs/digest-once.md",
      "./skills/builder-blog-digest/jobs/library-cron-setup.md",
      "./skills/builder-blog-digest/jobs/cloud-library-cron.md",
      "./skills/builder-blog-digest/jobs/digest-cron-setup.md",
      "./skills/builder-blog-digest/jobs/digest-cron.md",
      // Stop prompt is served by this route too; without it Vercel omits the
      // file from the bundle and the route 500s (ENOENT) in production.
      "./skills/builder-blog-digest/jobs/library-cron-stop.md",
      "./skills/builder-blog-digest/jobs/digest-cron-stop.md",
      "./config/local-agent-timeouts.json",
    ],
  },
};

export default nextConfig;
