import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  rateLimit,
  rateLimitKeyFromRequest,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";
import { readAgentTokenValue } from "@/lib/tokens";

const EXCHANGE_CODE_PATTERN = /^bb_ec_[A-Za-z0-9_-]{8,256}$/;
const clamp = (value: string | null, max: number) =>
  value ? value.trim().slice(0, max) : null;

// Uniform error returned for any malformed / not-found / expired / used
// code so the endpoint cannot be used as an enumeration oracle.
function invalidCodeResponse() {
  return NextResponse.json(
    { error: "Exchange code is invalid or expired" },
    { status: 400 },
  );
}

export async function POST(request: Request) {
  // Anonymous endpoint — cap exchanges per IP to slow any brute-force
  // attempt against the exchange-code space.
  const r = rateLimit({
    key: `exchange:${rateLimitKeyFromRequest(request)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!r.ok) {
    return tooManyRequestsResponse(r.retryAfterMs);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidCodeResponse();
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("code" in body) ||
    typeof (body as Record<string, unknown>).code !== "string"
  ) {
    return invalidCodeResponse();
  }

  const code = (body as { code: string }).code.trim();
  if (!EXCHANGE_CODE_PATTERN.test(code)) {
    return invalidCodeResponse();
  }

  const record = await prisma.exchangeCode.findUnique({
    where: { code },
    include: {
      agentToken: {
        select: {
          id: true,
          tokenValue: true,
          tokenCiphertext: true,
          revokedAt: true,
          user: { select: { id: true, email: true } },
        },
      },
    },
  });

  if (!record || record.usedAt || record.expiresAt < new Date() || record.agentToken.revokedAt) {
    // Burn any partial state so a discovered code is single-use.
    if (record && !record.usedAt) {
      await prisma.exchangeCode.delete({ where: { id: record.id } }).catch(() => undefined);
    }
    return invalidCodeResponse();
  }

  const tokenValue = readAgentTokenValue(record.agentToken);
  if (!tokenValue) {
    // Cannot recover the raw token (e.g. encryption key rotated and no
    // legacy plaintext). Treat as invalid rather than leak a 500.
    return invalidCodeResponse();
  }

  const lastUserAgent = request.headers.get("user-agent");
  const lastHostname = clamp(request.headers.get("x-machine-hostname"), 120);
  const lastPlatform = clamp(request.headers.get("x-machine-platform"), 120);
  const lastUser = clamp(request.headers.get("x-machine-user"), 80);

  // Single-use: delete the row outright so the raw mapping cannot be
  // re-exchanged or recovered from a DB dump.
  await prisma.$transaction([
    prisma.agentToken.update({
      where: { id: record.agentToken.id },
      data: {
        lastUsedAt: new Date(),
        lastIp:
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          new URL(request.url).hostname,
        ...(lastUserAgent ? { lastUserAgent } : {}),
        ...(lastHostname ? { lastHostname } : {}),
        ...(lastPlatform ? { lastPlatform } : {}),
        ...(lastUser ? { lastUser } : {}),
      },
    }),
    prisma.exchangeCode.delete({ where: { id: record.id } }),
  ]);

  const origin = new URL(request.url).origin;

  return NextResponse.json({
    token: tokenValue,
    email: record.agentToken.user.email,
    userId: record.agentToken.user.id,
    appUrl: origin,
  });
}
