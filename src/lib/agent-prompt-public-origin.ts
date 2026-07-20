const DEFAULT_AGENT_PROMPT_PUBLIC_ORIGIN =
  "https://followbrief.worldstatelabs.com";

function normalizeOrigin(value: string | null | undefined): string | null {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

export function resolveAgentPromptPublicOrigin(input?: {
  appBaseUrl?: string | null;
  nextauthUrl?: string | null;
}): string {
  return (
    normalizeOrigin(input?.appBaseUrl) ??
    normalizeOrigin(input?.nextauthUrl) ??
    DEFAULT_AGENT_PROMPT_PUBLIC_ORIGIN
  );
}
