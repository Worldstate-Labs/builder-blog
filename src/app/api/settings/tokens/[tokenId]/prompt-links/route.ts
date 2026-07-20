import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  AGENT_PROMPT_LINK_TTL_MS,
  createAgentPromptLinkToken,
  hashAgentPromptLinkToken,
  parseAgentPromptLinkOptions,
  type AgentPromptRenderOptions,
  type ExposedPromptJob,
} from "@/lib/agent-prompt-links";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ tokenId: string }> };

type SessionLike = {
  user?: {
    id?: string | null;
  } | null;
} | null;

type OwnedTokenRecord = {
  userId: string;
  revokedAt: Date | null;
};

type TransactionClient = {
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
};

export type PromptLinkHandlerDeps = {
  getCurrentSession(): Promise<SessionLike>;
  findToken(tokenId: string): Promise<OwnedTokenRecord | null>;
  parseOptions(job: ExposedPromptJob, input: unknown): AgentPromptRenderOptions;
  createExchangeCode(): string;
  createPromptLinkToken(): string;
  now(): Date;
  prisma: {
    $transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T>;
  };
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseRequestBody(input: unknown): { job: ExposedPromptJob; options: unknown } {
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

  return {
    job: input.job as ExposedPromptJob,
    options: input.options,
  };
}

export function createPromptLinkHandler(deps: PromptLinkHandlerDeps) {
  return async function POST(request: Request, { params }: Params) {
    const session = await deps.getCurrentSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tokenId } = await params;
    const token = await deps.findToken(tokenId);
    if (!token || token.userId !== session.user.id || token.revokedAt) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let job: ExposedPromptJob;
    let options: AgentPromptRenderOptions;

    try {
      const body = parseRequestBody(await request.json());
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
      url: new URL(`/p/${rawToken}`, request.url).toString(),
      expiresAt: expiresAt.toISOString(),
    });
  };
}

const defaultDeps: PromptLinkHandlerDeps = {
  getCurrentSession,
  findToken(tokenId) {
    return prisma.agentToken.findUnique({
      where: { id: tokenId },
      select: { userId: true, revokedAt: true },
    });
  },
  parseOptions: parseAgentPromptLinkOptions,
  createExchangeCode() {
    return `bb_ec_${randomBytes(16).toString("base64url")}`;
  },
  createPromptLinkToken: createAgentPromptLinkToken,
  now() {
    return new Date();
  },
  prisma,
};

export const POST = createPromptLinkHandler(defaultDeps);
