import {
  AGENT_PROMPT_LINK_PRIVACY_HEADERS,
  AGENT_PROMPT_LINK_TOKEN_PATTERN,
  hashAgentPromptLinkToken,
  parseAgentPromptLinkOptions,
  type AgentPromptRenderOptions,
  type ExposedPromptJob,
} from "@/lib/agent-prompt-links";
import {
  renderAgentPrompt,
  type NormalizedAgentPromptRenderOptions,
} from "@/lib/agent-prompt-renderer";
import { resolveAgentPromptPublicOrigin } from "@/lib/agent-prompt-public-origin";
import { createServerRenderAgentPromptDeps } from "@/lib/agent-prompt-renderer-server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ token: string }> };

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

const INVALID_PROMPT_LINK_MESSAGE =
  "This FollowBrief prompt link is invalid or expired. Return to FollowBrief and copy a new prompt.";
const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
const PLAINTEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

function buildHeaders(contentType: string) {
  return {
    ...AGENT_PROMPT_LINK_PRIVACY_HEADERS,
    "Content-Type": contentType,
  };
}

function invalidPromptLinkResponse(method: "GET" | "HEAD") {
  return new Response(method === "HEAD" ? null : INVALID_PROMPT_LINK_MESSAGE, {
    status: 404,
    headers: buildHeaders(PLAINTEXT_CONTENT_TYPE),
  });
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

function validateRecord(
  record: PromptLinkReadRecord | null,
  now: Date,
): PromptLinkReadRecord & {
  exchangeCode: NonNullable<PromptLinkReadRecord["exchangeCode"]> & {
    agentToken: NonNullable<NonNullable<PromptLinkReadRecord["exchangeCode"]>["agentToken"]>;
  };
} | null {
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
  return record as PromptLinkReadRecord & {
    exchangeCode: NonNullable<PromptLinkReadRecord["exchangeCode"]> & {
      agentToken: NonNullable<NonNullable<PromptLinkReadRecord["exchangeCode"]>["agentToken"]>;
    };
  };
}

async function handlePromptLinkRequest(
  deps: PromptLinkReadHandlerDeps,
  method: "GET" | "HEAD",
  request: Request,
  { params }: Params,
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
    job = record.job as ExposedPromptJob;
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
    GET(request: Request, params: Params) {
      return handlePromptLinkRequest(deps, "GET", request, params);
    },
    HEAD(request: Request, params: Params) {
      return handlePromptLinkRequest(deps, "HEAD", request, params);
    },
  };
}

const serverRenderDeps = createServerRenderAgentPromptDeps(prisma);

const defaultDeps: PromptLinkReadHandlerDeps = {
  hashToken: hashAgentPromptLinkToken,
  findPromptLinkByHash(tokenHash) {
    return prisma.agentPromptLink.findUnique({
      where: { tokenHash },
      select: {
        job: true,
        options: true,
        expiresAt: true,
        exchangeCode: {
          select: {
            code: true,
            usedAt: true,
            expiresAt: true,
            agentToken: {
              select: {
                revokedAt: true,
                user: {
                  select: {
                    email: true,
                    id: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  },
  parseOptions: parseAgentPromptLinkOptions,
  publicOrigin: resolveAgentPromptPublicOrigin({
    appBaseUrl: process.env.APP_BASE_URL,
    nextauthUrl: process.env.NEXTAUTH_URL,
  }),
  renderPrompt(input) {
    return renderAgentPrompt(input, serverRenderDeps);
  },
  now() {
    return new Date();
  },
};

export const { GET, HEAD } = createPromptLinkReadHandlers(defaultDeps);
