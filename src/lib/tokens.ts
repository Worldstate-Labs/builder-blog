import { createHash, randomBytes } from "crypto";
import { decryptToken, encryptToken } from "@/lib/token-encryption";

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newAgentToken() {
  return `bb_${randomBytes(32).toString("base64url")}`;
}

export async function createAgentToken(userId: string, name: string) {
  const { prisma } = await import("@/lib/prisma");
  const token = newAgentToken();
  const record = await prisma.agentToken.create({
    data: {
      userId,
      name,
      tokenHash: hashToken(token),
      tokenCiphertext: encryptToken(token),
      // tokenValue intentionally left null — legacy column kept for
      // backward-compat read only; new tokens never write plaintext.
    },
  });
  return { token, record };
}

/**
 * Resolve the raw agent token from a stored row. Reads the encrypted
 * column first; falls back to the legacy `tokenValue` column for rows
 * created before the ciphertext rollout. Returns null when neither
 * column can be resolved (e.g. stale row, missing key).
 */
export function readAgentTokenValue(record: {
  tokenCiphertext: string | null;
  tokenValue: string | null;
}): string | null {
  const decrypted = decryptToken(record.tokenCiphertext);
  if (decrypted) return decrypted;
  return record.tokenValue ?? null;
}

export async function getUserFromBearer(request: Request) {
  const { prisma } = await import("@/lib/prisma");
  const auth = request.headers.get("authorization");
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const record = await prisma.agentToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!record || record.revokedAt) return null;

  const lastIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    (request.url ? new URL(request.url).hostname : null);
  const lastUserAgent = request.headers.get("user-agent");
  // CLI-reported machine identity (clamped lengths to avoid header-stuffing
  // junk landing in the DB).
  const clamp = (value: string | null, max: number) =>
    value ? value.trim().slice(0, max) : null;
  const lastHostname = clamp(request.headers.get("x-machine-hostname"), 120);
  const lastPlatform = clamp(request.headers.get("x-machine-platform"), 120);
  const lastUser = clamp(request.headers.get("x-machine-user"), 80);

  await prisma.agentToken.update({
    where: { id: record.id },
    data: {
      lastUsedAt: new Date(),
      ...(lastIp ? { lastIp } : {}),
      ...(lastUserAgent ? { lastUserAgent } : {}),
      ...(lastHostname ? { lastHostname } : {}),
      ...(lastPlatform ? { lastPlatform } : {}),
      ...(lastUser ? { lastUser } : {}),
    },
  });

  return record.user;
}
