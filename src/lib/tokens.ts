import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

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
  const token = newAgentToken();
  const record = await prisma.agentToken.create({
    data: {
      userId,
      name,
      tokenHash: hashToken(token),
    },
  });
  return { token, record };
}

export async function getUserFromBearer(request: Request) {
  const auth = request.headers.get("authorization");
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const record = await prisma.agentToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!record || record.revokedAt) return null;

  await prisma.agentToken.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });

  return record.user;
}
