import { createHash, randomBytes } from "crypto";

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newAgentToken() {
  return `bb_${randomBytes(32).toString("base64url")}`;
}

export function newDeviceCode() {
  return randomBytes(5).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export async function createAgentToken(userId: string, name: string) {
  const { prisma } = await import("@/lib/prisma");
  const token = newAgentToken();
  const record = await prisma.agentToken.create({
    data: {
      userId,
      name,
      tokenHash: hashToken(token),
      tokenValue: token,
    },
  });
  return { token, record };
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

  await prisma.agentToken.update({
    where: { id: record.id },
    data: {
      lastUsedAt: new Date(),
      ...(lastIp ? { lastIp } : {}),
      ...(lastUserAgent ? { lastUserAgent } : {}),
    },
  });

  return record.user;
}
