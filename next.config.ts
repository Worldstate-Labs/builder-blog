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

// renderAgentPrompt and expandSkillIncludes load these assets through dynamic
// filesystem paths, which Next cannot infer. Keep one directory-scoped trace
// contract for every route that renders a prompt so new jobs and fragments are
// bundled automatically instead of requiring another synchronized file list.
const promptRuntimeTraceFiles = [
  "./skills/builder-blog-digest/jobs/*.md",
  "./config/local-agent-timeouts.json",
];
const completeAgentRuntimeTraceFiles = [
  "./scripts/builder-digest.mjs",
  "./scripts/new-product-launches.mjs",
  "./scripts/builder-agent-runner.sh",
  "./scripts/builder-library-cron-install.sh",
  "./scripts/cloud-shard-budget.mjs",
  "./scripts/run-storage.mjs",
  "./scripts/media-tool-failures.mjs",
  "./scripts/install-agent-skill-bundle.cjs",
  "./config/sources.json",
  ...promptRuntimeTraceFiles,
];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "builder-blog.worldstatelabs.com" }],
        destination: "https://followbrief.worldstatelabs.com/:path*",
        permanent: true,
      },
    ];
  },
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
    "/api/skill/files/[file]": completeAgentRuntimeTraceFiles,
    "/api/skill/bundle": completeAgentRuntimeTraceFiles,
    "/api/skill/bootstrap": ["./scripts/install-agent-skill-bundle.cjs"],
    "/api/skill/jobs/[job]/skill.md": promptRuntimeTraceFiles,
    "/p/[token]": promptRuntimeTraceFiles,
  },
};

export default nextConfig;
