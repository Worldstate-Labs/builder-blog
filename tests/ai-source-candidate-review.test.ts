import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AI_SOURCE_REVIEW_PROPOSALS,
  evaluateAiSourceAudit,
  type AiSourceAuditInput,
  type AiSourceReviewProposal,
} from "../src/lib/ai-source-candidate-review";

const EXPECTED_NAMES = [
  "One Useful Thing",
  "Chip Huyen",
  "Hamel Husain",
  "Eugene Yan",
  "Sam Altman",
  "Fei-Fei Li",
  "François Chollet",
  "SemiAnalysis",
  "AI Snake Oil",
  "fast.ai",
  "宝玉",
  "Georgi Gerganov",
  "World Labs",
  "Thinking Machines Lab",
  "Apple Machine Learning Research",
  "NVIDIA Research",
  "xAI News",
  "Qwen Blog",
  "DeepSeek Updates",
  "Ai2 News",
  "Sakana AI",
  "Nous Research",
  "Unsloth",
  "Perplexity Blog",
  "Artificial Analysis",
  "Epoch AI",
  "METR",
  "ARC Prize",
  "Demis Hassabis",
  "Yann LeCun",
  "Jim Fan",
  "Thomas Wolf",
  "Ilya Sutskever",
  "Dario Amodei",
  "Thibault Sottiaux",
  "Nan Yu",
  "Madhu Guru",
  "Amjad Masad",
  "Guillermo Rauch",
  "Aaron Levie",
  "Matt Turck",
] as const;

const EXPECTED_NEW_X_HANDLES = {
  "Thibault Sottiaux": "thsottiaux",
  "Nan Yu": "thenanyu",
  "Madhu Guru": "realmadhuguru",
  "Amjad Masad": "amasad",
  "Guillermo Rauch": "rauchg",
  "Aaron Levie": "levie",
  "Matt Turck": "mattturck",
} as const;

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON_PATH = resolve(WORKSPACE_ROOT, "package.json");
const AUDIT_CLI_PATH = resolve(WORKSPACE_ROOT, "scripts/audit-ai-source-candidates.ts");
const SOURCE_CANDIDATE_LIBRARY_PATH = resolve(
  WORKSPACE_ROOT,
  "src/lib/source-candidate-library.ts",
);
const AUDIT_REPORT_PATH = resolve(
  WORKSPACE_ROOT,
  "docs/superpowers/reports/2026-07-27-ai-source-candidate-audit.json",
);

function responseWithUrl(
  body: BodyInit | null | undefined,
  init: ResponseInit,
  url: string,
): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", {
    value: url,
    configurable: true,
  });
  return response;
}

function buildBlogAuditInput(
  overrides: Partial<AiSourceAuditInput> = {},
): AiSourceAuditInput {
  return {
    proposal: {
      name: "Test Blog",
      sourceType: "blog",
      sourceUrl: "https://example.com/blog",
    },
    http: {
      finalUrl: "https://example.com/blog",
      status: 200,
    },
    resolver: {
      ok: true,
      finalUrl: "https://example.com/blog",
      status: 200,
    },
    probe: {
      ok: true,
      finalUrl: "https://example.com/blog",
      status: 200,
      robotsDenied: false,
      loginRequired: false,
    },
    fetch: {
      itemCount: 1,
      recentItemCount: 1,
      actionableTasks: [],
    },
    x: {
      tokenState: "unknown",
      requestedHandle: null,
      resolvedHandle: null,
      exactHandleMatch: false,
    },
    icon: {
      url: "https://cdn.example.com/icon.png",
      safeUrl: true,
      downloaded: true,
    },
    ...overrides,
  };
}

function buildXAuditInput(
  overrides: Partial<AiSourceAuditInput> = {},
): AiSourceAuditInput {
  return {
    proposal: {
      name: "Test X",
      sourceType: "x",
      sourceUrl: "https://x.com/example",
      handle: "example",
    },
    http: {
      finalUrl: "https://x.com/example",
      status: 200,
    },
    resolver: {
      ok: true,
      finalUrl: "https://x.com/example",
      status: 200,
    },
    probe: {
      ok: true,
      finalUrl: "https://x.com/example",
      status: 200,
      robotsDenied: false,
      loginRequired: false,
    },
    fetch: {
      itemCount: 1,
      recentItemCount: 1,
      actionableTasks: [],
    },
    x: {
      tokenState: "accepted",
      requestedHandle: "example",
      resolvedHandle: "example",
      exactHandleMatch: true,
    },
    icon: {
      url: "https://pbs.twimg.com/profile_images/example.jpg",
      safeUrl: true,
      downloaded: true,
    },
    ...overrides,
  };
}

test("AI source review proposals lock the 41-source candidate review contract", () => {
  const proposals: readonly AiSourceReviewProposal[] = AI_SOURCE_REVIEW_PROPOSALS;

  assert.equal(proposals.length, 41);

  const actualNames = proposals.map((proposal) => proposal.name).sort();
  const expectedNames = [...EXPECTED_NAMES].sort();
  assert.deepEqual(actualNames, expectedNames);

  for (const proposal of proposals) {
    assert.ok(
      proposal.sourceType === "blog" || proposal.sourceType === "x",
      `${proposal.name} must use blog or x sourceType`,
    );
    assert.notEqual(proposal.sourceType, "website");

    const url = new URL(proposal.sourceUrl);
    assert.equal(url.protocol, "https:", `${proposal.name} must use HTTPS`);
    assert.notEqual(url.hostname, "github.com", `${proposal.name} must not use a GitHub profile`);

    if (proposal.sourceType === "x") {
      assert.ok(proposal.handle, `${proposal.name} must define a handle`);
      assert.equal(proposal.sourceUrl, `https://x.com/${proposal.handle}`);
    } else {
      assert.equal(proposal.handle, undefined, `${proposal.name} blog proposal must not define a handle`);
    }
  }

  const proposalByName = new Map<string, AiSourceReviewProposal>(
    proposals.map((proposal) => [proposal.name, proposal]),
  );

  for (const [name, handle] of Object.entries(EXPECTED_NEW_X_HANDLES)) {
    const proposal = proposalByName.get(name);
    assert.ok(proposal, `${name} proposal must exist`);
    assert.equal(proposal.sourceType, "x");
    assert.equal(proposal.handle, handle);
    assert.equal(proposal.sourceUrl, `https://x.com/${handle}`);
  }
});

test("evaluateAiSourceAudit accepts a blog with at least one real fetched item", () => {
  const input = buildBlogAuditInput();
  const result = evaluateAiSourceAudit(input);

  assert.equal(result.accepted, true);
  assert.equal(result.reason, null);
  assert.equal(result.proposal, input.proposal);
  assert.deepEqual(result.http, input.http);
  assert.deepEqual(result.resolver, input.resolver);
  assert.deepEqual(result.probe, input.probe);
  assert.equal(result.fetch.itemCount, 1);
  assert.equal(result.fetch.recentItemCount, 1);
  assert.equal(result.fetch.actionableTaskCount, 0);
  assert.deepEqual(result.fetch.actionableTaskTypes, []);
  assert.deepEqual(result.icon, input.icon);
});

test("evaluateAiSourceAudit accepts a blog with a recent actionable blog_article_fetch task", () => {
  const input = buildBlogAuditInput({
    fetch: {
      itemCount: 0,
      recentItemCount: 0,
      actionableTasks: [
        {
          type: "blog_article_fetch",
          recentDiscoveredContent: true,
        },
      ],
    },
  });

  const result = evaluateAiSourceAudit(input);

  assert.equal(result.accepted, true);
  assert.equal(result.reason, null);
  assert.equal(result.fetch.actionableTaskCount, 1);
  assert.deepEqual(result.fetch.actionableTaskTypes, ["blog_article_fetch"]);
});

test("evaluateAiSourceAudit rejects blog metadata-only results without recent content", () => {
  const result = evaluateAiSourceAudit(
    buildBlogAuditInput({
      fetch: {
        itemCount: 0,
        recentItemCount: 0,
        actionableTasks: [],
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "no_recent_content");
  assert.match(result.detail, /recent content/i);
});

test("evaluateAiSourceAudit rejects a blog when robots access is denied", () => {
  const result = evaluateAiSourceAudit(
    buildBlogAuditInput({
      probe: {
        ok: false,
        finalUrl: "https://example.com/blog",
        status: 403,
        robotsDenied: true,
        loginRequired: false,
      },
      fetch: {
        itemCount: 0,
        recentItemCount: 0,
        actionableTasks: [],
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "robots_denied");
});

test("evaluateAiSourceAudit rejects unsupported source types before other evidence is considered", () => {
  const result = evaluateAiSourceAudit(
    buildBlogAuditInput({
      proposal: {
        name: "Test Website",
        sourceType: "website",
        sourceUrl: "https://example.com",
      },
      fetch: {
        itemCount: 0,
        recentItemCount: 0,
        actionableTasks: [],
        hardFailure: true,
        hardFailureDetail: "should not win",
      },
      icon: {
        url: null,
        safeUrl: false,
        downloaded: false,
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "unsupported_source_type");
  assert.match(result.detail, /unsupported source type "website"/i);
});

test("evaluateAiSourceAudit rejects when resolver evidence failed", () => {
  const result = evaluateAiSourceAudit(
    buildBlogAuditInput({
      resolver: {
        ok: false,
        finalUrl: null,
        status: 302,
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "resolver_failed");
  assert.match(result.detail, /resolver did not succeed/i);
});

test("evaluateAiSourceAudit rejects login-walled probes as probe_failed", () => {
  const result = evaluateAiSourceAudit(
    buildBlogAuditInput({
      probe: {
        ok: true,
        finalUrl: "https://example.com/blog",
        status: 200,
        robotsDenied: false,
        loginRequired: true,
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "probe_failed");
  assert.match(result.detail, /source probe/i);
});

test("evaluateAiSourceAudit rejects hard fetch failures and preserves the fetch detail", () => {
  const result = evaluateAiSourceAudit(
    buildBlogAuditInput({
      fetch: {
        itemCount: 0,
        recentItemCount: 0,
        actionableTasks: [],
        hardFailure: true,
        hardFailureDetail: "Feed returned a corrupt payload",
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "hard_fetch_failed");
  assert.equal(result.detail, "Feed returned a corrupt payload");
});

test("evaluateAiSourceAudit rejects X handle mismatches after auth succeeds", () => {
  const result = evaluateAiSourceAudit(
    buildXAuditInput({
      x: {
        tokenState: "accepted",
        requestedHandle: "example",
        resolvedHandle: "someone-else",
        exactHandleMatch: false,
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "x_handle_mismatch");
  assert.match(result.detail, /did not exactly match/i);
});

test("evaluateAiSourceAudit accepts X when the exact handle resolves and a recent post exists", () => {
  const input = buildXAuditInput();
  const result = evaluateAiSourceAudit(input);

  assert.equal(result.accepted, true);
  assert.equal(result.reason, null);
  assert.deepEqual(result.x, input.x);
});

test("evaluateAiSourceAudit rejects X when the bearer token is missing", () => {
  const result = evaluateAiSourceAudit(
    buildXAuditInput({
      x: {
        tokenState: "missing",
        requestedHandle: "example",
        resolvedHandle: null,
        exactHandleMatch: false,
      },
      fetch: {
        itemCount: 0,
        recentItemCount: 0,
        actionableTasks: [],
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "x_token_missing");
});

test("evaluateAiSourceAudit rejects X when the bearer token is invalid", () => {
  const result = evaluateAiSourceAudit(
    buildXAuditInput({
      x: {
        tokenState: "invalid",
        requestedHandle: "example",
        resolvedHandle: null,
        exactHandleMatch: false,
      },
      fetch: {
        itemCount: 0,
        recentItemCount: 0,
        actionableTasks: [],
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "x_token_invalid");
});

test("evaluateAiSourceAudit treats unknown X token state as x_token_invalid", () => {
  const result = evaluateAiSourceAudit(
    buildXAuditInput({
      x: {
        tokenState: "unknown",
        requestedHandle: "example",
        resolvedHandle: "someone-else",
        exactHandleMatch: false,
      },
      fetch: {
        itemCount: 0,
        recentItemCount: 0,
        actionableTasks: [],
      },
      icon: {
        url: null,
        safeUrl: false,
        downloaded: false,
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "x_token_invalid");
});

test("evaluateAiSourceAudit rejects X when the exact handle resolves but no recent post exists", () => {
  const result = evaluateAiSourceAudit(
    buildXAuditInput({
      fetch: {
        itemCount: 0,
        recentItemCount: 0,
        actionableTasks: [],
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "no_recent_content");
});

test("evaluateAiSourceAudit rejects otherwise passable results when the icon download fails", () => {
  const result = evaluateAiSourceAudit(
    buildBlogAuditInput({
      icon: {
        url: "https://cdn.example.com/icon.png",
        safeUrl: true,
        downloaded: false,
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "icon_unavailable");
});

test("evaluateAiSourceAudit gives hard fetch failures precedence over robots, content, and icon failures", () => {
  const result = evaluateAiSourceAudit(
    buildBlogAuditInput({
      probe: {
        ok: false,
        finalUrl: "https://example.com/blog",
        status: 403,
        robotsDenied: true,
        loginRequired: false,
      },
      fetch: {
        itemCount: 0,
        recentItemCount: 0,
        actionableTasks: [],
        hardFailure: true,
        hardFailureDetail: "HTTP 500 while fetching feed",
      },
      icon: {
        url: null,
        safeUrl: false,
        downloaded: false,
      },
    }),
  );

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "hard_fetch_failed");
  assert.equal(result.detail, "HTTP 500 while fetching feed");
});

test("package.json exposes the production-equivalent AI source candidate audit command", () => {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(
    packageJson.scripts?.["sources:audit-ai-candidates"],
    "tsx --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/audit-ai-source-candidates.ts",
  );
});

test("audit AI source candidate CLI imports the production resolver, probe, avatar, and real builder fetchers", () => {
  assert.ok(
    existsSync(AUDIT_CLI_PATH),
    "scripts/audit-ai-source-candidates.ts must exist",
  );

  const source = readFileSync(AUDIT_CLI_PATH, "utf8");
  assert.match(source, /AI_SOURCE_REVIEW_PROPOSALS/);
  assert.match(source, /evaluateAiSourceAudit/);
  assert.match(source, /resolvePersonalBuilderInput/);
  assert.match(source, /probeAndEnrichSource/);
  assert.match(source, /resolveAvatarDataUrl/);
  assert.match(source, /fetchPersonalBlogBuilderForTest/);
  assert.match(source, /fetchPersonalXBuilderForTest/);
  assert.match(source, /from\s+["']\.\/builder-digest\.mjs["']/);
});

test("audit AI source candidate CLI uses an exact 90-day cutoff, emits sanitized JSON-only stdout, and keeps exit zero when candidates are excluded", async () => {
  assert.ok(
    existsSync(AUDIT_CLI_PATH),
    "scripts/audit-ai-source-candidates.ts must exist",
  );

  const mod = await import(pathToFileURL(AUDIT_CLI_PATH).href);
  const { probeAndEnrichSource } = await import("../src/lib/builder-enrichment");
  assert.equal(typeof mod.runAuditCli, "function");

  const now = new Date("2026-07-27T12:00:00.000Z");
  const expectedCutoffIso = new Date(
    now.getTime() - 90 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const blogCutoffs: string[] = [];
  const xCutoffs: string[] = [];
  let stdout = "";
  let stderr = "";
  const previousToken = process.env.X_BEARER_TOKEN;

  try {
    process.env.X_BEARER_TOKEN = "test-token";
    const exitCode = await mod.runAuditCli({
      now: () => new Date(now),
      stdout: {
        write(chunk: string) {
          stdout += chunk;
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk;
        },
      },
      proposals: [
        {
          name: "Audit Blog",
          sourceType: "blog",
          sourceUrl: "https://example.com/blog",
        },
        {
          name: "Audit X",
          sourceType: "x",
          sourceUrl: "https://x.com/auditx",
          handle: "auditx",
        },
        {
          name: "Broken Blog",
          sourceType: "blog",
          sourceUrl: "https://broken.example.com/blog",
          fetchUrl: "https://broken.example.com/feed.xml",
        },
      ],
      deps: {
        evaluateAiSourceAudit,
        fetchImpl: async (input: string | URL | Request) => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;
          if (url === "https://example.com/blog") {
            return responseWithUrl(
              `<!doctype html><html><head>
                <title>Audit Blog</title>
                <meta property="og:image" content="https://cdn.example.com/icon.png" />
                <link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml" />
              </head><body>Audit Blog</body></html>`,
              { status: 200, headers: { "content-type": "text/html" } },
              "https://www.example.com/blog",
            );
          }
          if (url === "https://broken.example.com/blog") {
            return responseWithUrl(
              `<!doctype html><html><head>
                <title>Broken Blog</title>
                <meta property="og:image" content="https://cdn.example.com/broken-icon.png" />
              </head><body>Broken Blog</body></html>`,
              { status: 200, headers: { "content-type": "text/html" } },
              "https://broken.example.com/blog",
            );
          }
          if (url === "https://example.com/feed.xml") {
            return responseWithUrl(
              `<?xml version="1.0"?><rss version="2.0"><channel><title>Audit Blog Feed</title></channel></rss>`,
              { status: 200, headers: { "content-type": "application/rss+xml" } },
              "https://feeds.example.com/feed.xml",
            );
          }
          if (url.includes("/2/users/by/username/auditx")) {
            return responseWithUrl(
              JSON.stringify({
                data: {
                  id: "user-1",
                  username: "AuditX",
                  profile_image_url: "https://pbs.twimg.com/profile_images/auditx_normal.jpg",
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
              "https://api.x.com/2/users/by/username/auditx?user.fields=name,profile_image_url",
            );
          }
          throw new Error(`Unexpected fetch URL: ${url}`);
        },
        resolvePersonalBuilderInput: async ({
          displayName,
          sourceType,
          sourceValue,
        }: {
          displayName: string;
          sourceType: string;
          sourceValue: string;
        }) => {
          if (sourceType === "x") {
            return {
              ok: true as const,
              value: {
                kind: "X",
                sourceType,
                name: displayName,
                handle: "auditx",
                sourceUrl: "https://x.com/auditx",
                fetchUrl: null,
              },
            };
          }
          return {
            ok: true as const,
            value: {
              kind: "BLOG",
              sourceType,
              name: displayName,
              handle: null,
              sourceUrl: sourceValue,
              fetchUrl: null,
            },
          };
        },
        probeAndEnrichSource,
        resolveAvatarDataUrl: async (avatarUrl: string | null) =>
          avatarUrl ? "data:image/png;base64,secret-avatar" : null,
        fetchPersonalBlogBuilderForTest: async (
          builder: { name: string; fetchUrl?: string | null },
          options: { cutoff: Date; fetcher?: (input: string) => Promise<Response> },
        ) => {
          blogCutoffs.push(options.cutoff.toISOString());
          if (builder.name === "Broken Blog") {
            throw new Error(
              "Authorization: Bearer test-secret X_BEARER_TOKEN body=<html>boom</html> postgres://db /Users/jie/code/builder_blog/.env.local data:image/png;base64,abc",
            );
          }
          if (builder.fetchUrl) {
            await options.fetcher?.(builder.fetchUrl);
          }
          return {
            items: [],
            agentTasks: [
              {
                type: "blog_article_fetch",
                item: { publishedAt: "2026-07-01T00:00:00.000Z" },
              },
              {
                type: "blog_article_fetch",
                item: { publishedAt: "2026-03-01T00:00:00.000Z" },
              },
              {
                type: "something_else",
                item: { publishedAt: "2026-07-02T00:00:00.000Z" },
              },
            ],
          };
        },
        fetchPersonalXBuilderForTest: async (
          _builder: { name: string },
          options: { cutoff: Date; fetcher?: (input: string) => Promise<Response> },
        ) => {
          xCutoffs.push(options.cutoff.toISOString());
          await options.fetcher?.(
            "https://api.x.com/2/users/by/username/auditx?user.fields=description",
          );
          return [
            {
              publishedAt: "2026-07-20T00:00:00.000Z",
              body: "Recent X post",
              externalId: "tweet-1",
              kind: "TWEET",
              url: "https://x.com/auditx/status/tweet-1",
            },
          ];
        },
      },
    });

    assert.equal(exitCode, 0);
  } finally {
    if (previousToken === undefined) {
      delete process.env.X_BEARER_TOKEN;
    } else {
      process.env.X_BEARER_TOKEN = previousToken;
    }
  }
  assert.equal(stderr, "");
  assert.ok(stdout.endsWith("\n"));

  const parsed = JSON.parse(stdout) as {
    cutoff: string;
    proposalCount: number;
    resultCount: number;
    results: Array<{
      proposal: { name: string };
      accepted: boolean;
      reason: string | null;
      http: {
        finalUrl: string | null;
        status: number | null;
      };
      probe: {
        finalUrl: string | null;
        status: number | null;
      };
      fetch: {
        recentItemCount: number;
        actionableTaskCount: number;
        actionableTaskTypes: string[];
        hardFailureDetail?: string | null;
      };
      x: {
        tokenState: string;
        exactHandleMatch: boolean;
        resolvedHandle: string | null;
      };
      icon: {
        url: string | null;
        downloaded: boolean;
      };
    }>;
  };

  assert.equal(parsed.cutoff, expectedCutoffIso);
  assert.equal(parsed.proposalCount, 3);
  assert.equal(parsed.resultCount, 3);
  assert.deepEqual(blogCutoffs, [expectedCutoffIso, expectedCutoffIso]);
  assert.deepEqual(xCutoffs, [expectedCutoffIso]);

  const resultsByName = new Map(parsed.results.map((result) => [result.proposal.name, result]));
  assert.equal(resultsByName.get("Audit Blog")?.accepted, true);
  assert.equal(resultsByName.get("Audit Blog")?.probe.status, 200);
  assert.equal(resultsByName.get("Audit Blog")?.probe.finalUrl, "https://www.example.com/blog");
  assert.equal(resultsByName.get("Audit Blog")?.http.status, 200);
  assert.equal(resultsByName.get("Audit Blog")?.http.finalUrl, "https://feeds.example.com/feed.xml");
  assert.equal(resultsByName.get("Audit Blog")?.fetch.recentItemCount, 0);
  assert.equal(resultsByName.get("Audit Blog")?.fetch.actionableTaskCount, 1);
  assert.deepEqual(resultsByName.get("Audit Blog")?.fetch.actionableTaskTypes, [
    "blog_article_fetch",
  ]);
  assert.equal(resultsByName.get("Audit X")?.accepted, true);
  assert.equal(resultsByName.get("Audit X")?.x.tokenState, "accepted");
  assert.equal(resultsByName.get("Audit X")?.x.exactHandleMatch, true);
  assert.equal(resultsByName.get("Audit X")?.x.resolvedHandle, "AuditX");
  assert.equal(
    resultsByName.get("Audit X")?.icon.url,
    "https://pbs.twimg.com/profile_images/auditx.jpg",
  );
  assert.equal(resultsByName.get("Audit X")?.icon.downloaded, true);
  assert.equal(resultsByName.get("Broken Blog")?.accepted, false);
  assert.equal(resultsByName.get("Broken Blog")?.reason, "hard_fetch_failed");

  const serialized = JSON.stringify(parsed);
  assert.doesNotMatch(serialized, /X_BEARER_TOKEN/);
  assert.doesNotMatch(serialized, /Authorization/i);
  assert.doesNotMatch(serialized, /data:image\//i);
  assert.doesNotMatch(serialized, /postgres:\/\//i);
  assert.doesNotMatch(serialized, /\/Users\/jie\//);
  assert.doesNotMatch(serialized, /body=<html>/i);
});

test("reviewed AI source candidates match the accepted July 27, 2026 audit report", async () => {
  assert.ok(
    existsSync(AUDIT_REPORT_PATH),
    "docs/superpowers/reports/2026-07-27-ai-source-candidate-audit.json must exist",
  );

  const report = JSON.parse(readFileSync(AUDIT_REPORT_PATH, "utf8")) as {
    complete: boolean;
    results: Array<{
      accepted: boolean;
      reason: string | null;
      proposal: {
        name: string;
        sourceType: string;
        sourceUrl: string;
        fetchUrl: string | null;
        handle: string | null;
      };
      icon: {
        url: string | null;
      };
    }>;
  };

  assert.equal(report.complete, true);
  assert.equal(report.results.length, 41);

  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = previousDatabaseUrl || "postgresql://user:pass@localhost:5432/builder_blog_test";
  const library = await import(pathToFileURL(SOURCE_CANDIDATE_LIBRARY_PATH).href) as {
    REVIEWED_AI_SOURCE_CANDIDATES?: Array<{
      name: string;
      sourceType: string;
      sourceUrl: string;
      fetchUrl?: string | null;
      avatarUrl?: string | null;
      handle?: string | null;
    }>;
    CURATED_AI_SOURCE_CANDIDATES?: Array<{
      name: string;
      sourceType: string;
      sourceUrl: string;
      avatarUrl?: string | null;
      handle?: string | null;
    }>;
    sourceKeyForCuratedCandidate?: (candidate: {
      name: string;
      sourceType: string;
      sourceUrl: string;
      avatarUrl?: string | null;
      handle?: string | null;
    }) => string;
  };
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }

  assert.ok(
    Array.isArray(library.REVIEWED_AI_SOURCE_CANDIDATES),
    "REVIEWED_AI_SOURCE_CANDIDATES must be exported",
  );
  assert.ok(
    Array.isArray(library.CURATED_AI_SOURCE_CANDIDATES),
    "CURATED_AI_SOURCE_CANDIDATES must be exported",
  );
  assert.equal(
    typeof library.sourceKeyForCuratedCandidate,
    "function",
    "sourceKeyForCuratedCandidate must be exported",
  );

  const acceptedNames = report.results
    .filter((result) => result.accepted)
    .map((result) => result.proposal.name)
    .sort();
  const reviewedNames = library.REVIEWED_AI_SOURCE_CANDIDATES
    .map((candidate) => candidate.name)
    .sort();
  assert.deepEqual(reviewedNames, acceptedNames);

  const reviewedNameSet = new Set(reviewedNames);
  for (const candidate of library.REVIEWED_AI_SOURCE_CANDIDATES) {
    assert.ok(
      candidate.sourceType === "blog" || candidate.sourceType === "x",
      `${candidate.name} must use a supported reviewed sourceType`,
    );
    assert.equal(
      new URL(candidate.sourceUrl).protocol,
      "https:",
      `${candidate.name} must use an HTTPS sourceUrl`,
    );
    assert.ok(candidate.avatarUrl, `${candidate.name} must define an explicit avatarUrl`);
    if (candidate.sourceType === "x") {
      assert.ok(candidate.handle, `${candidate.name} must define an X handle`);
    }

    const audited = report.results.find(
      (result) => result.accepted && result.proposal.name === candidate.name,
    );
    assert.ok(audited, `${candidate.name} must have accepted audit evidence`);
    assert.deepEqual(
      {
        sourceType: candidate.sourceType,
        sourceUrl: candidate.sourceUrl,
        fetchUrl: candidate.fetchUrl ?? null,
        handle: candidate.handle ?? null,
        avatarUrl: candidate.avatarUrl ?? null,
      },
      {
        sourceType: audited.proposal.sourceType,
        sourceUrl: audited.proposal.sourceUrl,
        fetchUrl: audited.proposal.fetchUrl,
        handle: audited.proposal.handle,
        avatarUrl: audited.icon.url,
      },
      `${candidate.name} must exactly match its accepted audit evidence`,
    );
  }

  const aiKeys = library.CURATED_AI_SOURCE_CANDIDATES.map((candidate) =>
    library.sourceKeyForCuratedCandidate!(candidate),
  );
  assert.equal(new Set(aiKeys).size, aiKeys.length, "curated AI canonical keys must be unique");

  for (const result of report.results) {
    if (result.accepted) {
      assert.ok(
        reviewedNameSet.has(result.proposal.name),
        `${result.proposal.name} must be included in REVIEWED_AI_SOURCE_CANDIDATES`,
      );
    } else {
      assert.ok(
        !reviewedNameSet.has(result.proposal.name),
        `${result.proposal.name} must be excluded from REVIEWED_AI_SOURCE_CANDIDATES`,
      );
      assert.ok(result.reason, `${result.proposal.name} must keep a rejection reason`);
    }
  }
});

test("audit AI source candidate CLI rejects X when only a generic x.com favicon is available", async () => {
  assert.ok(
    existsSync(AUDIT_CLI_PATH),
    "scripts/audit-ai-source-candidates.ts must exist",
  );

  const mod = await import(pathToFileURL(AUDIT_CLI_PATH).href);
  let stdout = "";

  const exitCode = await mod.runAuditCli({
    now: () => new Date("2026-07-27T12:00:00.000Z"),
    stdout: {
      write(chunk: string) {
        stdout += chunk;
      },
    },
    stderr: {
      write() {},
    },
    proposals: [
      {
        name: "Audit X",
        sourceType: "x",
        sourceUrl: "https://x.com/auditx",
        handle: "auditx",
      },
    ],
    deps: {
      evaluateAiSourceAudit,
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: { id: "user-1", username: "auditx" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      resolvePersonalBuilderInput: async () => ({
        ok: true as const,
        value: {
          kind: "X",
          sourceType: "x",
          name: "Audit X",
          handle: "auditx",
          sourceUrl: "https://x.com/auditx",
          fetchUrl: null,
        },
      }),
      probeAndEnrichSource: async () => ({
        ok: true,
        enrichment: {},
      }),
      resolveAvatarDataUrl: async () => "data:image/png;base64,secret-avatar",
      fetchPersonalBlogBuilderForTest: async () => ({
        items: [],
        agentTasks: [],
      }),
      fetchPersonalXBuilderForTest: async (
        _builder: { name: string },
        options: { fetcher?: (input: string) => Promise<Response> },
      ) => {
        await options.fetcher?.(
          "https://api.x.com/2/users/by/username/auditx?user.fields=description",
        );
        return {
          items: [
            {
              publishedAt: "2026-07-20T00:00:00.000Z",
            },
          ],
          agentTasks: [],
        };
      },
    },
  });

  assert.equal(exitCode, 0);

  const parsed = JSON.parse(stdout) as {
    results: Array<{
      accepted: boolean;
      reason: string | null;
      icon: {
        url: string | null;
        downloaded: boolean;
      };
    }>;
  };

  assert.equal(parsed.results.length, 1);
  assert.equal(parsed.results[0]?.accepted, false);
  assert.equal(parsed.results[0]?.reason, "icon_unavailable");
  assert.equal(parsed.results[0]?.icon.url, null);
});

test("audit AI source candidate CLI rejects X when token is accepted but exact handle lookup evidence was not observed", async () => {
  assert.ok(
    existsSync(AUDIT_CLI_PATH),
    "scripts/audit-ai-source-candidates.ts must exist",
  );

  const mod = await import(pathToFileURL(AUDIT_CLI_PATH).href);
  let stdout = "";

  const exitCode = await mod.runAuditCli({
    now: () => new Date("2026-07-27T12:00:00.000Z"),
    stdout: {
      write(chunk: string) {
        stdout += chunk;
      },
    },
    stderr: {
      write() {},
    },
    proposals: [
      {
        name: "Audit X",
        sourceType: "x",
        sourceUrl: "https://x.com/auditx",
        handle: "auditx",
      },
    ],
    deps: {
      evaluateAiSourceAudit,
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: { id: "user-1", username: "auditx" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      resolvePersonalBuilderInput: async () => ({
        ok: true as const,
        value: {
          kind: "X",
          sourceType: "x",
          name: "Audit X",
          handle: "auditx",
          sourceUrl: "https://x.com/auditx",
          fetchUrl: null,
        },
      }),
      probeAndEnrichSource: async () => ({
        ok: true,
        enrichment: {
          avatarUrl: "https://pbs.twimg.com/profile_images/auditx.jpg",
        },
      }),
      resolveAvatarDataUrl: async () => "data:image/png;base64,secret-avatar",
      fetchPersonalBlogBuilderForTest: async () => ({
        items: [],
        agentTasks: [],
      }),
      fetchPersonalXBuilderForTest: async () => ({
        items: [
          {
            publishedAt: "2026-07-20T00:00:00.000Z",
          },
        ],
        agentTasks: [],
      }),
    },
  });

  assert.equal(exitCode, 0);

  const parsed = JSON.parse(stdout) as {
    results: Array<{
      accepted: boolean;
      reason: string | null;
      x: {
        tokenState: string;
        exactHandleMatch: boolean;
      };
      fetch: {
        recentItemCount: number;
      };
    }>;
  };

  assert.equal(parsed.results.length, 1);
  assert.equal(parsed.results[0]?.accepted, false);
  assert.equal(parsed.results[0]?.reason, "x_handle_mismatch");
  assert.equal(parsed.results[0]?.x.tokenState, "accepted");
  assert.equal(parsed.results[0]?.x.exactHandleMatch, false);
  assert.equal(parsed.results[0]?.fetch.recentItemCount, 1);
});

test("audit AI source candidate CLI rejects X when lookup resolves a different username", async () => {
  assert.ok(
    existsSync(AUDIT_CLI_PATH),
    "scripts/audit-ai-source-candidates.ts must exist",
  );

  const mod = await import(pathToFileURL(AUDIT_CLI_PATH).href);
  let stdout = "";

  const exitCode = await mod.runAuditCli({
    now: () => new Date("2026-07-27T12:00:00.000Z"),
    stdout: {
      write(chunk: string) {
        stdout += chunk;
      },
    },
    stderr: {
      write() {},
    },
    proposals: [
      {
        name: "Audit X",
        sourceType: "x",
        sourceUrl: "https://x.com/auditx",
        handle: "auditx",
      },
    ],
    deps: {
      evaluateAiSourceAudit,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ data: { id: "user-1", username: "someoneElse" } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      resolvePersonalBuilderInput: async () => ({
        ok: true as const,
        value: {
          kind: "X",
          sourceType: "x",
          name: "Audit X",
          handle: "auditx",
          sourceUrl: "https://x.com/auditx",
          fetchUrl: null,
        },
      }),
      probeAndEnrichSource: async () => ({
        ok: true,
        enrichment: {
          avatarUrl: "https://pbs.twimg.com/profile_images/auditx.jpg",
        },
      }),
      resolveAvatarDataUrl: async () => "data:image/png;base64,secret-avatar",
      fetchPersonalBlogBuilderForTest: async () => ({
        items: [],
        agentTasks: [],
      }),
      fetchPersonalXBuilderForTest: async (
        _builder: { name: string },
        options: { fetcher?: (input: string) => Promise<Response> },
      ) => {
        await options.fetcher?.(
          "https://api.x.com/2/users/by/username/auditx?user.fields=description",
        );
        return {
          items: [
            {
              publishedAt: "2026-07-20T00:00:00.000Z",
            },
          ],
          agentTasks: [],
        };
      },
    },
  });

  assert.equal(exitCode, 0);

  const parsed = JSON.parse(stdout) as {
    results: Array<{
      accepted: boolean;
      reason: string | null;
      x: {
        tokenState: string;
        exactHandleMatch: boolean;
        resolvedHandle: string | null;
      };
    }>;
  };

  assert.equal(parsed.results.length, 1);
  assert.equal(parsed.results[0]?.accepted, false);
  assert.equal(parsed.results[0]?.reason, "x_handle_mismatch");
  assert.equal(parsed.results[0]?.x.tokenState, "accepted");
  assert.equal(parsed.results[0]?.x.exactHandleMatch, false);
  assert.equal(parsed.results[0]?.x.resolvedHandle, "someoneElse");
});

test("audit AI source candidate CLI preserves observed evidence when a later candidate-local stage fails", async () => {
  assert.ok(
    existsSync(AUDIT_CLI_PATH),
    "scripts/audit-ai-source-candidates.ts must exist",
  );

  const mod = await import(pathToFileURL(AUDIT_CLI_PATH).href);
  let stdout = "";

  const exitCode = await mod.runAuditCli({
    now: () => new Date("2026-07-27T12:00:00.000Z"),
    stdout: {
      write(chunk: string) {
        stdout += chunk;
      },
    },
    stderr: {
      write() {},
    },
    proposals: [
      {
        name: "Fetch Failure Blog",
        sourceType: "blog",
        sourceUrl: "https://fetch-failure.example.com/blog",
      },
      {
        name: "Icon Failure X",
        sourceType: "x",
        sourceUrl: "https://x.com/iconfailure",
        handle: "iconfailure",
      },
      {
        name: "Audit Blog",
        sourceType: "blog",
        sourceUrl: "https://example.com/blog",
      },
    ],
    deps: {
      evaluateAiSourceAudit,
      fetchImpl: async (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url === "https://fetch-failure.example.com/blog") {
          return responseWithUrl(
            '<!doctype html><html><head><title>Fetch Failure Blog</title><meta property="og:image" content="https://cdn.example.com/fetch-failure-icon.png" /></head><body>Fetch Failure Blog</body></html>',
            { status: 200, headers: { "content-type": "text/html" } },
            "https://www.fetch-failure.example.com/blog",
          );
        }
        if (url.includes("/2/users/by/username/iconfailure")) {
          return responseWithUrl(
            JSON.stringify({
              data: {
                id: "user-icon-failure",
                username: "iconfailure",
                profile_image_url: "https://pbs.twimg.com/profile_images/iconfailure_normal.jpg",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
            "https://api.x.com/2/users/by/username/iconfailure?user.fields=name,profile_image_url",
          );
        }
        if (url === "https://x.com/iconfailure") {
          return responseWithUrl(
            '<!doctype html><html><head><title>Icon Failure X</title></head><body>Icon Failure X</body></html>',
            { status: 200, headers: { "content-type": "text/html" } },
            "https://x.com/iconfailure",
          );
        }
        return responseWithUrl(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>Audit Feed</title></channel></rss>`,
          { status: 200, headers: { "content-type": "application/rss+xml" } },
          "https://example.com/feed.xml",
        );
      },
      resolvePersonalBuilderInput: async ({
        displayName,
        sourceType,
        sourceValue,
      }: {
        displayName: string;
        sourceType: string;
        sourceValue: string;
      }) =>
        sourceType === "x"
          ? ({
              ok: true as const,
              value: {
                kind: "X",
                sourceType,
                name: displayName,
                handle: "iconfailure",
                sourceUrl: sourceValue,
                fetchUrl: null,
              },
            })
          : ({
              ok: true as const,
              value: {
                kind: "BLOG",
                sourceType,
                name: displayName,
                handle: null,
                sourceUrl: sourceValue,
                fetchUrl: sourceValue,
              },
            }),
      probeAndEnrichSource: async ({
        sourceUrl,
        fetcher,
      }: {
        sourceUrl: string | null;
        fetcher?: (input: string) => Promise<Response>;
      }) => {
        if (sourceUrl) {
          await fetcher?.(sourceUrl);
        }
        if (sourceUrl?.includes("broken")) {
          throw new Error("unreachable");
        }
        if (sourceUrl?.includes("fetch-failure")) {
          return {
            ok: true,
            enrichment: {
              avatarUrl: "https://cdn.example.com/fetch-failure-icon.png",
            },
          };
        }
        if (sourceUrl?.includes("iconfailure")) {
          return {
            ok: true,
            enrichment: {},
          };
        }
        return {
          ok: true,
          enrichment: {
            avatarUrl: "https://cdn.example.com/icon.png",
          },
        };
      },
      resolveAvatarDataUrl: async (avatarUrl: string | null) => {
        if (avatarUrl?.includes("iconfailure")) {
          throw new Error(
            "Authorization: Bearer test-secret X_BEARER_TOKEN body=<html>boom</html> postgres://db /Users/jie/code/builder_blog/.env.local",
          );
        }
        return "data:image/png;base64,secret-avatar";
      },
      fetchPersonalBlogBuilderForTest: async (
        builder: { name: string; fetchUrl?: string | null },
        options: { fetcher?: (input: string) => Promise<Response> },
      ) => {
        if (builder.fetchUrl) {
          await options.fetcher?.(builder.fetchUrl);
        }
        if (builder.name === "Fetch Failure Blog") {
          throw new Error(
            "Authorization: Bearer test-secret X_BEARER_TOKEN body=<html>boom</html> postgres://db /Users/jie/code/builder_blog/.env.local",
          );
        }
        return {
          items: [],
          agentTasks: [
            {
              type: "blog_article_fetch",
              item: { publishedAt: "2026-07-01T00:00:00.000Z" },
            },
          ],
        };
      },
      fetchPersonalXBuilderForTest: async (
        _builder: { name: string; handle?: string | null },
        options: { fetcher?: (input: string) => Promise<Response> },
      ) => {
        await options.fetcher?.(
          "https://api.x.com/2/users/by/username/iconfailure?user.fields=description",
        );
        return {
          items: [
            {
              publishedAt: "2026-07-20T00:00:00.000Z",
            },
          ],
          agentTasks: [],
        };
      },
    },
  });

  assert.equal(exitCode, 0);

  const parsed = JSON.parse(stdout) as {
    complete: boolean;
    runtimeError: string | null;
    resultCount: number;
    results: Array<{
      proposal: { name: string };
      accepted: boolean;
      reason: string | null;
      detail: string;
      http: {
        finalUrl: string | null;
        status: number | null;
      };
      probe: {
        finalUrl: string | null;
        status: number | null;
      };
      icon: {
        url: string | null;
        downloaded: boolean;
      };
    }>;
  };

  assert.equal(parsed.complete, true);
  assert.equal(parsed.runtimeError, null);
  assert.equal(parsed.resultCount, 3);

  const resultsByName = new Map(parsed.results.map((result) => [result.proposal.name, result]));
  assert.equal(resultsByName.get("Fetch Failure Blog")?.accepted, false);
  assert.equal(resultsByName.get("Fetch Failure Blog")?.reason, "hard_fetch_failed");
  assert.equal(resultsByName.get("Fetch Failure Blog")?.probe.status, 200);
  assert.equal(
    resultsByName.get("Fetch Failure Blog")?.probe.finalUrl,
    "https://www.fetch-failure.example.com/blog",
  );
  assert.equal(resultsByName.get("Fetch Failure Blog")?.http.status, 200);
  assert.equal(
    resultsByName.get("Fetch Failure Blog")?.http.finalUrl,
    "https://www.fetch-failure.example.com/blog",
  );
  assert.equal(
    resultsByName.get("Fetch Failure Blog")?.icon.url,
    "https://cdn.example.com/fetch-failure-icon.png",
  );
  assert.equal(resultsByName.get("Fetch Failure Blog")?.icon.downloaded, true);
  assert.equal(resultsByName.get("Icon Failure X")?.accepted, false);
  assert.equal(resultsByName.get("Icon Failure X")?.reason, "icon_unavailable");
  assert.equal(resultsByName.get("Icon Failure X")?.probe.status, 200);
  assert.equal(
    resultsByName.get("Icon Failure X")?.probe.finalUrl,
    "https://x.com/iconfailure",
  );
  assert.equal(resultsByName.get("Icon Failure X")?.http.status, 200);
  assert.equal(
    resultsByName.get("Icon Failure X")?.http.finalUrl,
    "https://api.x.com/2/users/by/username/iconfailure?user.fields=name,profile_image_url",
  );
  assert.equal(
    resultsByName.get("Icon Failure X")?.icon.url,
    "https://pbs.twimg.com/profile_images/iconfailure_normal.jpg",
  );
  assert.equal(resultsByName.get("Icon Failure X")?.icon.downloaded, false);
  assert.equal(resultsByName.get("Audit Blog")?.accepted, true);

  const serialized = JSON.stringify(parsed);
  assert.doesNotMatch(serialized, /X_BEARER_TOKEN/);
  assert.doesNotMatch(serialized, /Authorization/i);
  assert.doesNotMatch(serialized, /data:image\//i);
  assert.doesNotMatch(serialized, /postgres:\/\//i);
  assert.doesNotMatch(serialized, /\/Users\/jie\//);
  assert.doesNotMatch(serialized, /body=<html>/i);
});
