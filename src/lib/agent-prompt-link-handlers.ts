import { NextResponse } from "next/server";
import {
  AGENT_PROMPT_LINK_PRIVACY_HEADERS,
  AGENT_PROMPT_LINK_TOKEN_PATTERN,
  AGENT_PROMPT_LINK_TTL_MS,
  hashAgentPromptLinkToken,
  type AgentPromptRenderOptions,
  type ExposedPromptJob,
} from "@/lib/agent-prompt-links";
import { tooManyRequestsResponse } from "@/lib/rate-limit";
import type { NormalizedAgentPromptRenderOptions } from "@/lib/agent-prompt-renderer";

type ParamsWithTokenId = { params: Promise<{ tokenId: string }> };

export type PromptLinkHandlerDeps = {
  getCurrentSession(): Promise<{ user?: { id?: string | null } | null } | null>;
  findToken(tokenId: string): Promise<{ userId: string; revokedAt: Date | null } | null>;
  parseOptions(job: ExposedPromptJob, input: unknown): AgentPromptRenderOptions;
  createExchangeCode(): string;
  createPromptLinkToken(): string;
  publicOrigin: string;
  rateLimit(key: string): { ok: boolean; remaining: number; retryAfterMs: number };
  now(): Date;
  prisma: {
    $transaction<T>(callback: (tx: {
      exchangeCode: {
        create(args: {
          data: {
            code: string;
            agentTokenId: string;
            expiresAt: Date;
          };
          select: { id: true };
        }): Promise<{ id: string }>;
      };
      agentPromptLink: {
        create(args: {
          data: {
            tokenHash: string;
            exchangeCodeId: string;
            job: string;
            options: AgentPromptRenderOptions;
            expiresAt: Date;
          };
        }): Promise<{ id: string }>;
      };
    }) => Promise<T>): Promise<T>;
  };
};

type PromptLinkRequestBody = { job: ExposedPromptJob; options: unknown };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parsePromptLinkBody(input: unknown): PromptLinkRequestBody {
  if (!isPlainObject(input)) {
    throw new Error("Prompt link body must be an object.");
  }
  const allowedKeys = new Set(["job", "options"]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown prompt link field: ${key}.`);
    }
  }
  if (typeof input.job !== "string") {
    throw new Error("Prompt link job is required.");
  }
  if (!Object.prototype.hasOwnProperty.call(input, "options")) {
    throw new Error("Prompt link options are required.");
  }
  return { job: input.job as ExposedPromptJob, options: input.options };
}

export function createPromptLinkHandler(deps: PromptLinkHandlerDeps) {
  return async function POST(request: Request, { params }: ParamsWithTokenId) {
    const session = await deps.getCurrentSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tokenId } = await params;
    const limit = deps.rateLimit(`prompt-link:${session.user.id}:${tokenId}`);
    if (!limit.ok) {
      return tooManyRequestsResponse(limit.retryAfterMs);
    }

    const token = await deps.findToken(tokenId);
    if (!token || token.userId !== session.user.id || token.revokedAt) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let job: ExposedPromptJob;
    let options: AgentPromptRenderOptions;
    try {
      const body = parsePromptLinkBody(await request.json());
      job = body.job;
      options = deps.parseOptions(body.job, body.options);
    } catch {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const expiresAt = new Date(deps.now().getTime() + AGENT_PROMPT_LINK_TTL_MS);
    const code = deps.createExchangeCode();
    const rawToken = deps.createPromptLinkToken();

    await deps.prisma.$transaction(async (tx) => {
      const exchangeCode = await tx.exchangeCode.create({
        data: {
          code,
          agentTokenId: tokenId,
          expiresAt,
        },
        select: { id: true },
      });

      await tx.agentPromptLink.create({
        data: {
          tokenHash: hashAgentPromptLinkToken(rawToken),
          exchangeCodeId: exchangeCode.id,
          job,
          options,
          expiresAt,
        },
      });
    });

    return NextResponse.json({
      url: new URL(`/p/${rawToken}`, deps.publicOrigin).toString(),
      expiresAt: expiresAt.toISOString(),
    });
  };
}

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

export type PromptLinkReadHandlerDeps = {
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

export const INVALID_PROMPT_LINK_MESSAGE =
  "This FollowBrief prompt link is invalid or expired. Return to FollowBrief and copy a new prompt.";
const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
const PLAINTEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

function buildHeaders(contentType: string) {
  return {
    ...AGENT_PROMPT_LINK_PRIVACY_HEADERS,
    "Content-Type": contentType,
  };
}

function normalizePromptLinkOptions(
  options: AgentPromptRenderOptions,
): NormalizedAgentPromptRenderOptions {
  return {
    runtime: options.runtime ?? null,
    frequency: options.frequency ?? "daily",
    force: options.force ?? false,
    fetchDays: options.fetchDays ?? 30,
    parallelWorkers: options.parallelWorkers ?? 10,
    fetchLimit: 3,
  };
}

function invalidPromptLinkResponse(method: "GET" | "HEAD") {
  return new Response(method === "HEAD" ? null : INVALID_PROMPT_LINK_MESSAGE, {
    status: 404,
    headers: buildHeaders(PLAINTEXT_CONTENT_TYPE),
  });
}

type RecordWithValidation = {
  job: ExposedPromptJob;
  options: unknown;
  exchangeCode: {
    code: string;
    usedAt: Date | null;
    expiresAt: Date;
    agentToken: {
      revokedAt: Date | null;
      user: {
        email: string | null;
        id: string;
      };
    };
  };
};

function validateRecord(
  record: PromptLinkReadRecord | null,
  now: Date,
): RecordWithValidation | null {
  if (!record || record.expiresAt < now) {
    return null;
  }
  if (
    !record.exchangeCode ||
    record.exchangeCode.usedAt ||
    record.exchangeCode.expiresAt < now ||
    !record.exchangeCode.agentToken ||
    record.exchangeCode.agentToken.revokedAt
  ) {
    return null;
  }
  return {
    job: record.job as ExposedPromptJob,
    options: record.options,
    exchangeCode: {
      code: record.exchangeCode.code,
      usedAt: record.exchangeCode.usedAt,
      expiresAt: record.exchangeCode.expiresAt,
      agentToken: {
        revokedAt: record.exchangeCode.agentToken.revokedAt,
        user: {
          email: record.exchangeCode.agentToken.user.email,
          id: record.exchangeCode.agentToken.user.id,
        },
      },
    },
  };
}

async function handlePromptLinkRequest(
  deps: PromptLinkReadHandlerDeps,
  method: "GET" | "HEAD",
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!AGENT_PROMPT_LINK_TOKEN_PATTERN.test(token)) {
    return invalidPromptLinkResponse(method);
  }

  const record = validateRecord(
    await deps.findPromptLinkByHash(deps.hashToken(token)),
    deps.now(),
  );
  if (!record) {
    return invalidPromptLinkResponse(method);
  }

  let job: ExposedPromptJob;
  let options: NormalizedAgentPromptRenderOptions;
  try {
    job = record.job;
    options = normalizePromptLinkOptions(deps.parseOptions(job, record.options));
  } catch {
    return invalidPromptLinkResponse(method);
  }

  const headers = buildHeaders(MARKDOWN_CONTENT_TYPE);
  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  const content = await deps.renderPrompt({
    origin: deps.publicOrigin,
    job,
    options,
    exchange: {
      code: record.exchangeCode.code,
      accountEmail: record.exchangeCode.agentToken.user.email ?? "",
      accountUserId: record.exchangeCode.agentToken.user.id,
    },
  });

  return new Response(content, {
    status: 200,
    headers,
  });
}

export function createPromptLinkReadHandlers(deps: PromptLinkReadHandlerDeps) {
  return {
    GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
      return handlePromptLinkRequest(deps, "GET", { params });
    },
    HEAD(_request: Request, { params }: { params: Promise<{ token: string }> }) {
      return handlePromptLinkRequest(deps, "HEAD", { params });
    },
  };
}
