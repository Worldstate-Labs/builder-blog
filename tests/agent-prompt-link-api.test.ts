import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_PROMPT_LINK_PRIVACY_HEADERS,
  AGENT_PROMPT_LINK_TTL_MS,
  hashAgentPromptLinkToken,
  parseAgentPromptLinkOptions,
  type AgentPromptRenderOptions,
  type ExposedPromptJob,
} from "../src/lib/agent-prompt-links";
import type { PromptLinkHandlerDeps } from "../src/app/api/settings/tokens/[tokenId]/prompt-links/route";
import type { NormalizedAgentPromptRenderOptions } from "../src/lib/agent-prompt-renderer";

const ROUTE_MODULE_PATH = "../src/app/api/settings/tokens/[tokenId]/prompt-links/route";
const READ_ROUTE_MODULE_PATH = "../src/app/p/[token]/route";
const PUBLIC_ORIGIN_MODULE_PATH = "../src/lib/agent-prompt-public-origin";
const INVALID_PROMPT_LINK_MESSAGE =
  "This FollowBrief prompt link is invalid or expired. Return to FollowBrief and copy a new prompt.";

async function loadRouteModule() {
  process.env.DATABASE_URL ??= "postgres://followbrief:followbrief@127.0.0.1:5432/followbrief";
  return import(ROUTE_MODULE_PATH);
}

async function loadReadRouteModule() {
  process.env.DATABASE_URL ??= "postgres://followbrief:followbrief@127.0.0.1:5432/followbrief";
  return import(READ_ROUTE_MODULE_PATH);
}

async function loadPublicOriginModule() {
  return import(PUBLIC_ORIGIN_MODULE_PATH);
}

type HandlerDeps = PromptLinkHandlerDeps;
type ParseJob = Parameters<HandlerDeps["parseOptions"]>[0];
type ParseInput = Parameters<HandlerDeps["parseOptions"]>[1];
type PromptLinkReadRecord = {
  job: string;
  options: unknown;
  expiresAt: Date;
  exchangeCode:
    | {
        code: string;
        usedAt: Date | null;
        expiresAt: Date;
        agentToken:
          | {
              revokedAt: Date | null;
              user: {
                email: string | null;
                id: string;
              };
            }
          | null;
      }
    | null;
};
type PromptLinkReadDeps = {
  hashToken(token: string): string;
  findPromptLinkByHash(hash: string): Promise<PromptLinkReadRecord | null>;
  parseOptions(job: ExposedPromptJob, input: unknown): AgentPromptRenderOptions;
  publicOrigin: string;
  renderPrompt(input: {
    origin: string;
    job: ExposedPromptJob;
    options: NormalizedAgentPromptRenderOptions;
    exchange: {
      code: string;
      accountEmail: string;
      accountUserId: string;
    };
  }): Promise<string>;
  now(): Date;
};
type PromptLinkReadHarness = {
  observed: {
    hashCalls: string[];
    findCalls: string[];
    parseCalls: Array<{ job: ExposedPromptJob; input: unknown }>;
    renderCalls: Array<{
      origin: string;
      job: ExposedPromptJob;
      options: NormalizedAgentPromptRenderOptions;
      exchange: {
        code: string;
        accountEmail: string;
        accountUserId: string;
      };
    }>;
  };
};
type PromptLinkReadTestDeps = PromptLinkReadDeps & PromptLinkReadHarness;
type TransactionHarness = {
  prisma: HandlerDeps["prisma"];
  committed: {
    exchangeCodes: Array<Record<string, unknown>>;
    promptLinks: Array<Record<string, unknown>>;
  };
  observed: {
    transactionCalls: number;
    findTokenCalls: number;
    exchangeCreates: Array<Record<string, unknown>>;
    promptLinkCreates: Array<Record<string, unknown>>;
  };
};
type TestDeps = HandlerDeps &
  TransactionHarness & {
    publicOrigin: string;
    rateLimit: () => { ok: boolean; remaining: number; retryAfterMs: number };
  };

function makeRequest(body: BodyInit, url = "https://followbrief.example/api/settings/tokens/token_123/prompt-links") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function makePromptLinkRequest(
  token: string,
  method: "GET" | "HEAD" = "GET",
  origin = "https://prompt-host.example",
) {
  return new Request(`${origin}/p/${token}`, { method });
}

function successSession() {
  return { user: { id: "user_123" } };
}

function createTransactionHarness(): TransactionHarness {
  const committed = {
    exchangeCodes: [] as Array<Record<string, unknown>>,
    promptLinks: [] as Array<Record<string, unknown>>,
  };
  const observed = {
    transactionCalls: 0,
    findTokenCalls: 0,
    exchangeCreates: [] as Array<Record<string, unknown>>,
    promptLinkCreates: [] as Array<Record<string, unknown>>,
  };

  const prisma = {
    async $transaction<T>(callback: (tx: {
      exchangeCode: { create(args: Record<string, unknown>): Promise<{ id: string }> };
      agentPromptLink: { create(args: Record<string, unknown>): Promise<{ id: string }> };
    }) => Promise<T>) {
      observed.transactionCalls += 1;
      const staged = {
        exchangeCodes: [] as Array<Record<string, unknown>>,
        promptLinks: [] as Array<Record<string, unknown>>,
      };
      const tx = {
        exchangeCode: {
          async create(args: Record<string, unknown>) {
            observed.exchangeCreates.push(args);
            staged.exchangeCodes.push(args);
            return { id: "exchange_record_123" };
          },
        },
        agentPromptLink: {
          async create(args: Record<string, unknown>) {
            observed.promptLinkCreates.push(args);
            staged.promptLinks.push(args);
            return { id: "prompt_link_123" };
          },
        },
      };
      const result = await callback(tx);
      committed.exchangeCodes.push(...staged.exchangeCodes);
      committed.promptLinks.push(...staged.promptLinks);
      return result;
    },
  };

  return { prisma, committed, observed };
}

function createDeps(overrides: Partial<HandlerDeps> = {}): TestDeps {
  const transaction = createTransactionHarness();
  return {
    ...transaction,
    getCurrentSession: async () => successSession(),
    findToken: async () => {
      transaction.observed.findTokenCalls += 1;
      return { userId: "user_123", revokedAt: null };
    },
    parseOptions: () => ({}),
    createExchangeCode: () => "bb_ec_test_exchange_code",
    createPromptLinkToken: () => "fbp_test_prompt_link_token_1234567890",
    now: () => new Date("2026-07-20T12:00:00.000Z"),
    publicOrigin: "https://followbrief.example",
    rateLimit: () => ({ ok: true, remaining: 19, retryAfterMs: 0 }),
    ...overrides,
  } as TestDeps;
}

function createPromptLinkReadRecord(
  overrides: Partial<PromptLinkReadRecord> = {},
): PromptLinkReadRecord {
  return {
    job: "library-cron-setup",
    options: {
      runtime: "openclaw",
      frequency: "weekly",
      force: true,
      fetchDays: 11,
      parallelWorkers: 3,
    },
    expiresAt: new Date("2026-07-20T12:10:00.000Z"),
    exchangeCode: {
      code: "bb_ec_prompt_link_read_exchange",
      usedAt: null,
      expiresAt: new Date("2026-07-20T12:10:00.000Z"),
      agentToken: {
        revokedAt: null,
        user: {
          email: "reader@example.com",
          id: "user_prompt_reader",
        },
      },
    },
    ...overrides,
  };
}

function createPromptLinkReadDeps(
  overrides: Partial<PromptLinkReadDeps> = {},
): PromptLinkReadTestDeps {
  const record = createPromptLinkReadRecord();
  const observed: PromptLinkReadHarness["observed"] = {
    hashCalls: [],
    findCalls: [],
    parseCalls: [],
    renderCalls: [],
  };

  return {
    observed,
    hashToken(token: string) {
      observed.hashCalls.push(token);
      return `hashed:${token}`;
    },
    async findPromptLinkByHash(hash: string) {
      observed.findCalls.push(hash);
      return record;
    },
    parseOptions(job: ExposedPromptJob, input: unknown) {
      observed.parseCalls.push({ job, input });
      return parseAgentPromptLinkOptions(job, input);
    },
    async renderPrompt(input) {
      observed.renderCalls.push(input);
      return `# Prompt for ${input.exchange.accountEmail}\nOrigin: ${input.origin}\n`;
    },
    publicOrigin: "https://followbrief.example",
    now() {
      return new Date("2026-07-20T12:00:00.000Z");
    },
    ...overrides,
  };
}

async function assertPromptLinkPrivacyHeaders(response: Response) {
  for (const [name, value] of Object.entries(AGENT_PROMPT_LINK_PRIVACY_HEADERS)) {
    assert.equal(response.headers.get(name), value);
  }
}

async function assertInvalidPromptLinkResponse(
  response: Response,
  method: "GET" | "HEAD",
) {
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  await assertPromptLinkPrivacyHeaders(response);
  assert.equal(
    await response.text(),
    method === "HEAD" ? "" : INVALID_PROMPT_LINK_MESSAGE,
  );
}

test("route module exports the POST handler factory and route handler", async () => {
  const routeModule = await loadRouteModule();

  assert.equal(typeof routeModule.createPromptLinkHandler, "function");
  assert.equal(typeof routeModule.POST, "function");
});

test("prompt-link read route exports a handler factory plus GET and HEAD handlers", async () => {
  const routeModule = await loadReadRouteModule();

  assert.equal(typeof routeModule.createPromptLinkReadHandlers, "function");
  assert.equal(typeof routeModule.GET, "function");
  assert.equal(typeof routeModule.HEAD, "function");
});

test("shared public-origin resolver prefers APP_BASE_URL, falls back to NEXTAUTH_URL, and normalizes to origin", async () => {
  const publicOriginModule = await loadPublicOriginModule();

  assert.equal(
    publicOriginModule.resolveAgentPromptPublicOrigin({
      appBaseUrl: "https://app.followbrief.example/some/path?x=1",
      nextauthUrl: "https://nextauth.followbrief.example/ignored",
    }),
    "https://app.followbrief.example",
  );
  assert.equal(
    publicOriginModule.resolveAgentPromptPublicOrigin({
      appBaseUrl: "not a url",
      nextauthUrl: "https://nextauth.followbrief.example/auth/signin",
    }),
    "https://nextauth.followbrief.example",
  );
  assert.equal(
    publicOriginModule.resolveAgentPromptPublicOrigin({
      appBaseUrl: "",
      nextauthUrl: "",
    }),
    "https://followbrief.worldstatelabs.com",
  );
});

test("POST returns 401 when the caller is not authenticated", async () => {
  const { createPromptLinkHandler } = await loadRouteModule();
  const deps = createDeps({
    getCurrentSession: async () => null,
  });

  const response = await createPromptLinkHandler(deps)(
    makeRequest(JSON.stringify({ job: "library-once", options: {} })),
    { params: Promise.resolve({ tokenId: "token_123" }) },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.equal(deps.observed.findTokenCalls, 0);
  assert.equal(deps.observed.transactionCalls, 0);
});

test("POST rate limits authenticated prompt-link creation before token lookup or writes", async () => {
  const { createPromptLinkHandler } = await loadRouteModule();
  const deps = createDeps({
    rateLimit: () => ({ ok: false, remaining: 0, retryAfterMs: 2500 }),
  });

  const response = await createPromptLinkHandler(deps)(
    makeRequest(JSON.stringify({ job: "library-once", options: {} })),
    { params: Promise.resolve({ tokenId: "token_123" }) },
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "3");
  assert.deepEqual(await response.json(), { error: "Too many requests" });
  assert.equal(deps.observed.findTokenCalls, 0);
  assert.equal(deps.observed.transactionCalls, 0);
});

test("POST returns a uniform 404 for missing, non-owned, or revoked access keys", async () => {
  const { createPromptLinkHandler } = await loadRouteModule();

  for (const token of [
    null,
    { userId: "other_user", revokedAt: null },
    { userId: "user_123", revokedAt: new Date("2026-07-19T00:00:00.000Z") },
  ]) {
    const deps = createDeps({
      findToken: async () => token,
    });

    const response = await createPromptLinkHandler(deps)(
      makeRequest(JSON.stringify({ job: "library-once", options: {} })),
      { params: Promise.resolve({ tokenId: "token_123" }) },
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Not found" });
    assert.equal(deps.observed.transactionCalls, 0);
  }
});

test("POST returns 400 for malformed JSON, invalid job/options, or unknown top-level keys without writing", async () => {
  const { createPromptLinkHandler } = await loadRouteModule();

  const cases = [
    {
      request: makeRequest("{"),
      deps: createDeps(),
    },
    {
      request: makeRequest(JSON.stringify({ job: "bad-job", options: {} })),
      deps: createDeps({
        parseOptions: () => {
          throw new Error("Prompt link job is invalid.");
        },
      }),
    },
    {
      request: makeRequest(JSON.stringify({ job: "library-once", options: { runtime: "gpt5" } })),
      deps: createDeps({
        parseOptions: () => {
          throw new Error("Prompt link option runtime is invalid.");
        },
      }),
    },
    {
      request: makeRequest(
        JSON.stringify({ job: "library-once", options: {}, tokenId: "attacker_token", exchangeCode: "evil" }),
      ),
      deps: createDeps(),
    },
  ];

  for (const { request, deps } of cases) {
    const response = await createPromptLinkHandler(deps)(request, {
      params: Promise.resolve({ tokenId: "token_123" }),
    });

    assert.equal(response.status, 400);
    assert.equal(deps.observed.transactionCalls, 0);
    assert.deepEqual(deps.committed, {
      exchangeCodes: [],
      promptLinks: [],
    });
  }
});

test("POST creates an exchange code and hashed prompt link atomically with one shared ten-minute expiry and returns only the prompt URL", async () => {
  const { createPromptLinkHandler } = await loadRouteModule();
  const deps = createDeps({
    parseOptions: (job: ParseJob, options: ParseInput) => {
      assert.equal(job, "library-cron-setup");
      assert.deepEqual(options, { runtime: "codex", frequency: "daily", fetchDays: 7 });
      return { runtime: "codex", frequency: "daily", fetchDays: 7 };
    },
  });

  const response = await createPromptLinkHandler(deps)(
    makeRequest(
      JSON.stringify({
        job: "library-cron-setup",
        options: { runtime: "codex", frequency: "daily", fetchDays: 7 },
      }),
    ),
    { params: Promise.resolve({ tokenId: "token_123" }) },
  );

  assert.equal(deps.observed.transactionCalls, 1);
  assert.equal(deps.observed.exchangeCreates.length, 1);
  assert.equal(deps.observed.promptLinkCreates.length, 1);

  const exchangeCreate = deps.observed.exchangeCreates[0];
  const promptLinkCreate = deps.observed.promptLinkCreates[0];
  const exchangeData = exchangeCreate.data as Record<string, unknown>;
  const promptLinkData = promptLinkCreate.data as Record<string, unknown>;

  assert.equal(exchangeData.code, "bb_ec_test_exchange_code");
  assert.equal(exchangeData.agentTokenId, "token_123");
  assert.equal(promptLinkData.exchangeCodeId, "exchange_record_123");
  assert.equal(promptLinkData.job, "library-cron-setup");
  assert.deepEqual(promptLinkData.options, {
    runtime: "codex",
    frequency: "daily",
    fetchDays: 7,
  });

  const exchangeExpiresAt = exchangeData.expiresAt as Date;
  const promptLinkExpiresAt = promptLinkData.expiresAt as Date;
  assert.ok(exchangeExpiresAt instanceof Date);
  assert.ok(promptLinkExpiresAt instanceof Date);
  assert.equal(exchangeExpiresAt.toISOString(), promptLinkExpiresAt.toISOString());
  assert.equal(exchangeExpiresAt.toISOString(), "2026-07-20T12:10:00.000Z");
  assert.equal(exchangeExpiresAt.getTime() - deps.now().getTime(), AGENT_PROMPT_LINK_TTL_MS);

  assert.equal(
    promptLinkData.tokenHash,
    hashAgentPromptLinkToken("fbp_test_prompt_link_token_1234567890"),
  );
  assert.equal("token" in promptLinkData, false);
  assert.equal("rawToken" in promptLinkData, false);
  assert.equal("tokenValue" in promptLinkData, false);

  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, string>;
  assert.deepEqual(Object.keys(body).sort(), ["expiresAt", "url"]);
  assert.equal(body.expiresAt, "2026-07-20T12:10:00.000Z");
  assert.equal(body.url, "https://followbrief.example/p/fbp_test_prompt_link_token_1234567890");
  assert.equal("code" in body, false);
  assert.equal("exchangeCode" in body, false);
  assert.equal("token" in body, false);

  assert.deepEqual(deps.committed, {
    exchangeCodes: [exchangeCreate],
    promptLinks: [promptLinkCreate],
  });
});

test("POST always returns the prompt URL on the trusted public origin instead of reflecting a hostile request origin", async () => {
  const { createPromptLinkHandler } = await loadRouteModule();
  const deps = createDeps({
    publicOrigin: "https://followbrief.example",
  });

  const response = await createPromptLinkHandler(deps)(
    makeRequest(
      JSON.stringify({ job: "library-once", options: {} }),
      "https://evil.example/api/settings/tokens/token_123/prompt-links",
    ),
    { params: Promise.resolve({ tokenId: "token_123" }) },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, string>;
  assert.equal(body.url, "https://followbrief.example/p/fbp_test_prompt_link_token_1234567890");
  assert.notEqual(body.url, "https://evil.example/p/fbp_test_prompt_link_token_1234567890");
});

test("POST lets the authenticated route path choose the access key and rejects body attempts to override it", async () => {
  const { createPromptLinkHandler } = await loadRouteModule();
  const deps = createDeps();

  const response = await createPromptLinkHandler(deps)(
    makeRequest(JSON.stringify({ job: "digest-once", options: {} })),
    { params: Promise.resolve({ tokenId: "token_from_path" }) },
  );

  assert.equal(response.status, 200);
  const exchangeData = deps.observed.exchangeCreates[0].data as Record<string, unknown>;
  assert.equal(exchangeData.agentTokenId, "token_from_path");
});

test("POST bubbles unexpected transaction failures and commits neither record", async () => {
  const { createPromptLinkHandler } = await loadRouteModule();
  const deps = createDeps({
    prisma: {
      async $transaction<T>(callback: (tx: {
        exchangeCode: { create(args: Record<string, unknown>): Promise<{ id: string }> };
        agentPromptLink: { create(args: Record<string, unknown>): Promise<{ id: string }> };
      }) => Promise<T>) {
        const staged = {
          exchangeCodes: [] as Array<Record<string, unknown>>,
          promptLinks: [] as Array<Record<string, unknown>>,
        };
        await callback({
          exchangeCode: {
            async create(args: Record<string, unknown>) {
              staged.exchangeCodes.push(args);
              return { id: "exchange_record_123" };
            },
          },
          agentPromptLink: {
            async create(args: Record<string, unknown>) {
              staged.promptLinks.push(args);
              throw new Error("database unavailable");
            },
          },
        });
        throw new Error("unreachable");
      },
    },
  });

  await assert.rejects(
    createPromptLinkHandler(deps)(
      makeRequest(JSON.stringify({ job: "library-once", options: {} })),
      { params: Promise.resolve({ tokenId: "token_123" }) },
    ),
    /database unavailable/,
  );

  assert.deepEqual(deps.committed, {
    exchangeCodes: [],
    promptLinks: [],
  });
});

test("GET rejects malformed prompt-link tokens with a uniform 404 before hashing or lookup", async () => {
  const { createPromptLinkReadHandlers } = await loadReadRouteModule();
  const deps = createPromptLinkReadDeps();

  const response = await createPromptLinkReadHandlers(deps).GET(
    makePromptLinkRequest("not_a_valid_prompt_link"),
    { params: Promise.resolve({ token: "not_a_valid_prompt_link" }) },
  );

  await assertInvalidPromptLinkResponse(response, "GET");
  assert.deepEqual(deps.observed.hashCalls, []);
  assert.deepEqual(deps.observed.findCalls, []);
  assert.deepEqual(deps.observed.parseCalls, []);
  assert.deepEqual(deps.observed.renderCalls, []);
});

test("GET returns the same uniform 404 for missing, expired, missing exchange, redeemed exchange, and revoked token records", async () => {
  const { createPromptLinkReadHandlers } = await loadReadRouteModule();

  const baseExchange = createPromptLinkReadRecord().exchangeCode!;
  const revokedAgentToken = baseExchange.agentToken!;
  const cases: Array<PromptLinkReadRecord | null> = [
    null,
    createPromptLinkReadRecord({
      expiresAt: new Date("2026-07-20T11:59:59.000Z"),
    }),
    createPromptLinkReadRecord({ exchangeCode: null }),
    createPromptLinkReadRecord({
      exchangeCode: {
        ...baseExchange,
        usedAt: new Date("2026-07-20T12:01:00.000Z"),
      },
    }),
    createPromptLinkReadRecord({
      exchangeCode: {
        ...baseExchange,
        expiresAt: new Date("2026-07-20T11:59:59.000Z"),
      },
    }),
    createPromptLinkReadRecord({
      exchangeCode: {
        ...baseExchange,
        agentToken: {
          ...revokedAgentToken,
          revokedAt: new Date("2026-07-20T12:01:00.000Z"),
        },
      },
    }),
  ];

  for (const record of cases) {
    const deps = createPromptLinkReadDeps();
    deps.findPromptLinkByHash = async (hash: string) => {
      deps.observed.findCalls.push(hash);
      return record;
    };

    const response = await createPromptLinkReadHandlers(deps).GET(
      makePromptLinkRequest("fbp_valid_prompt_link_token_123456"),
      { params: Promise.resolve({ token: "fbp_valid_prompt_link_token_123456" }) },
    );

    await assertInvalidPromptLinkResponse(response, "GET");
    assert.equal(deps.observed.hashCalls.length, 1);
    assert.equal(deps.observed.findCalls.length, 1);
    assert.deepEqual(deps.observed.renderCalls, []);
  }
});

test("GET revalidates persisted job and options through the parser and returns the same 404 for malformed stored data", async () => {
  const { createPromptLinkReadHandlers } = await loadReadRouteModule();

  const invalidPersistedCases = [
    createPromptLinkReadRecord({ job: "not-an-exposed-job" }),
    createPromptLinkReadRecord({
      options: { runtime: "gpt5" },
    }),
  ];

  for (const record of invalidPersistedCases) {
    const deps = createPromptLinkReadDeps();
    deps.findPromptLinkByHash = async (hash: string) => {
      deps.observed.findCalls.push(hash);
      return record;
    };

    const response = await createPromptLinkReadHandlers(deps).GET(
      makePromptLinkRequest("fbp_valid_prompt_link_token_123456"),
      { params: Promise.resolve({ token: "fbp_valid_prompt_link_token_123456" }) },
    );

    await assertInvalidPromptLinkResponse(response, "GET");
    assert.equal(deps.observed.parseCalls.length, 1);
    assert.deepEqual(deps.observed.renderCalls, []);
  }
});

test("GET returns rendered markdown directly, keeps the link reusable, and passes validated exchange plus trusted public origin to the renderer", async () => {
  const { createPromptLinkReadHandlers } = await loadReadRouteModule();
  const deps = createPromptLinkReadDeps();

  const getOnce = () =>
    createPromptLinkReadHandlers(deps).GET(
      makePromptLinkRequest(
        "fbp_valid_prompt_link_token_123456",
        "GET",
        "https://prompt-host.example",
      ),
      { params: Promise.resolve({ token: "fbp_valid_prompt_link_token_123456" }) },
    );

  const first = await getOnce();
  const second = await getOnce();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(first.headers.get("location"), null);
  await assertPromptLinkPrivacyHeaders(first);
  await assertPromptLinkPrivacyHeaders(second);
  assert.equal(
    await first.text(),
    "# Prompt for reader@example.com\nOrigin: https://followbrief.example\n",
  );
  assert.equal(
    await second.text(),
    "# Prompt for reader@example.com\nOrigin: https://followbrief.example\n",
  );

  assert.deepEqual(deps.observed.parseCalls, [
    {
      job: "library-cron-setup",
      input: {
        runtime: "openclaw",
        frequency: "weekly",
        force: true,
        fetchDays: 11,
        parallelWorkers: 3,
      },
    },
    {
      job: "library-cron-setup",
      input: {
        runtime: "openclaw",
        frequency: "weekly",
        force: true,
        fetchDays: 11,
        parallelWorkers: 3,
      },
    },
  ]);
  assert.deepEqual(deps.observed.renderCalls, [
    {
      origin: "https://followbrief.example",
      job: "library-cron-setup",
      options: {
        runtime: "openclaw",
        frequency: "weekly",
        force: true,
        fetchDays: 11,
        parallelWorkers: 3,
        fetchLimit: 3,
      },
      exchange: {
        code: "bb_ec_prompt_link_read_exchange",
        accountEmail: "reader@example.com",
        accountUserId: "user_prompt_reader",
      },
    },
    {
      origin: "https://followbrief.example",
      job: "library-cron-setup",
      options: {
        runtime: "openclaw",
        frequency: "weekly",
        force: true,
        fetchDays: 11,
        parallelWorkers: 3,
        fetchLimit: 3,
      },
      exchange: {
        code: "bb_ec_prompt_link_read_exchange",
        accountEmail: "reader@example.com",
        accountUserId: "user_prompt_reader",
      },
    },
  ]);
});

test("GET never lets a hostile request origin override the trusted public origin passed to the renderer", async () => {
  const { createPromptLinkReadHandlers } = await loadReadRouteModule();
  const deps = createPromptLinkReadDeps({
    publicOrigin: "https://followbrief.example",
  });

  const response = await createPromptLinkReadHandlers(deps).GET(
    makePromptLinkRequest(
      "fbp_valid_prompt_link_token_123456",
      "GET",
      "https://attacker.example",
    ),
    { params: Promise.resolve({ token: "fbp_valid_prompt_link_token_123456" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(
    await response.text(),
    "# Prompt for reader@example.com\nOrigin: https://followbrief.example\n",
  );
  assert.equal(deps.observed.renderCalls.length, 1);
  assert.equal(deps.observed.renderCalls[0]?.origin, "https://followbrief.example");
});

test("HEAD returns the same validation and privacy headers with an empty body and skips rendering", async () => {
  const { createPromptLinkReadHandlers } = await loadReadRouteModule();
  const deps = createPromptLinkReadDeps();

  const response = await createPromptLinkReadHandlers(deps).HEAD(
    makePromptLinkRequest("fbp_valid_prompt_link_token_123456", "HEAD"),
    { params: Promise.resolve({ token: "fbp_valid_prompt_link_token_123456" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
  await assertPromptLinkPrivacyHeaders(response);
  assert.equal(await response.text(), "");
  assert.equal(deps.observed.parseCalls.length, 1);
  assert.deepEqual(deps.observed.renderCalls, []);
});

test("HEAD returns the same uniform invalid response metadata without rendering", async () => {
  const { createPromptLinkReadHandlers } = await loadReadRouteModule();
  const deps = createPromptLinkReadDeps();
  deps.findPromptLinkByHash = async (hash: string) => {
    deps.observed.findCalls.push(hash);
    return null;
  };

  const response = await createPromptLinkReadHandlers(deps).HEAD(
    makePromptLinkRequest("fbp_valid_prompt_link_token_123456", "HEAD"),
    { params: Promise.resolve({ token: "fbp_valid_prompt_link_token_123456" }) },
  );

  await assertInvalidPromptLinkResponse(response, "HEAD");
  assert.equal(deps.observed.parseCalls.length, 0);
  assert.deepEqual(deps.observed.renderCalls, []);
});
