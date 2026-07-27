import assert from "node:assert/strict";
import test from "node:test";
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
