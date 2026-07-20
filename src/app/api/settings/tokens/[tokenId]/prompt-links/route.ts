import { randomBytes } from "node:crypto";
import {
  createAgentPromptLinkToken,
  parseAgentPromptLinkOptions,
} from "@/lib/agent-prompt-links";
import { rateLimit } from "@/lib/rate-limit";
import { resolveAgentPromptPublicOrigin } from "@/lib/agent-prompt-public-origin";
import { getCurrentSession } from "@/lib/auth";
import { createPromptLinkHandler, type PromptLinkHandlerDeps } from "@/lib/agent-prompt-link-handlers";
import { prisma } from "@/lib/prisma";

const PROMPT_LINK_LIMIT = 20;
const PROMPT_LINK_WINDOW_MS = 10 * 60 * 1000;

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
  publicOrigin: resolveAgentPromptPublicOrigin({
    appBaseUrl: process.env.APP_BASE_URL,
    nextauthUrl: process.env.NEXTAUTH_URL,
  }),
  rateLimit(key) {
    return rateLimit({
      key,
      limit: PROMPT_LINK_LIMIT,
      windowMs: PROMPT_LINK_WINDOW_MS,
    });
  },
  now() {
    return new Date();
  },
  prisma,
};

const handlePost = createPromptLinkHandler(defaultDeps);

export async function POST(
  request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  return handlePost(request, context);
}
