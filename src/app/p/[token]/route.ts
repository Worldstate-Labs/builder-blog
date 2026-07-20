import {
  hashAgentPromptLinkToken,
  parseAgentPromptLinkOptions,
} from "@/lib/agent-prompt-links";
import { renderAgentPrompt } from "@/lib/agent-prompt-renderer";
import {
  createPromptLinkReadHandlers,
  type PromptLinkReadHandlerDeps,
} from "@/lib/agent-prompt-link-handlers";
import { resolveAgentPromptPublicOrigin } from "@/lib/agent-prompt-public-origin";
import { createServerRenderAgentPromptDeps } from "@/lib/agent-prompt-renderer-server";
import { prisma } from "@/lib/prisma";

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

const handlers = createPromptLinkReadHandlers(defaultDeps);

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return handlers.GET(request, context);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  return handlers.HEAD(request, context);
}
