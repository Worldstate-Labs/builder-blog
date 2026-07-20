import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_PROMPT_LINK_TTL_MS,
  hashAgentPromptLinkToken,
} from "../src/lib/agent-prompt-links";
import type { PromptLinkHandlerDeps } from "../src/app/api/settings/tokens/[tokenId]/prompt-links/route";

const ROUTE_MODULE_PATH = "../src/app/api/settings/tokens/[tokenId]/prompt-links/route";

async function loadRouteModule() {
  process.env.DATABASE_URL ??= "postgres://followbrief:followbrief@127.0.0.1:5432/followbrief";
  return import(ROUTE_MODULE_PATH);
}

type HandlerDeps = PromptLinkHandlerDeps;
type ParseJob = Parameters<HandlerDeps["parseOptions"]>[0];
type ParseInput = Parameters<HandlerDeps["parseOptions"]>[1];
type TransactionHarness = {
  prisma: HandlerDeps["prisma"];
  committed: {
    exchangeCodes: Array<Record<string, unknown>>;
    promptLinks: Array<Record<string, unknown>>;
  };
  observed: {
    transactionCalls: number;
    exchangeCreates: Array<Record<string, unknown>>;
    promptLinkCreates: Array<Record<string, unknown>>;
  };
};
type TestDeps = HandlerDeps & TransactionHarness;

function makeRequest(body: BodyInit, url = "https://followbrief.example/api/settings/tokens/token_123/prompt-links") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
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
    findToken: async () => ({ userId: "user_123", revokedAt: null }),
    parseOptions: () => ({}),
    createExchangeCode: () => "bb_ec_test_exchange_code",
    createPromptLinkToken: () => "fbp_test_prompt_link_token_1234567890",
    now: () => new Date("2026-07-20T12:00:00.000Z"),
    ...overrides,
  };
}

test("route module exports the POST handler factory and route handler", async () => {
  const routeModule = await loadRouteModule();

  assert.equal(typeof routeModule.createPromptLinkHandler, "function");
  assert.equal(typeof routeModule.POST, "function");
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
