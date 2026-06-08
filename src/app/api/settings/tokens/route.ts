import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { createAgentToken } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";

const TokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Token creation is a high-value action — cap to a handful per
  // 5-minute window per user to slow account-takeover automation
  // that may have already grabbed a session cookie.
  const r = rateLimit({
    key: `token-create:${session.user.id}`,
    limit: 5,
    windowMs: 5 * 60_000,
  });
  if (!r.ok) {
    return tooManyRequestsResponse(r.retryAfterMs);
  }

  const parsed = TokenCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: formatZodError(parsed.error) },
      { status: 400 },
    );
  }
  const name = parsed.data.name ?? "Local Agent access";

  const { token, record } = await createAgentToken(session.user.id, name);

  return NextResponse.json({
    token,
    record: {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt.toISOString(),
      lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
      lastIp: record.lastIp ?? null,
      lastUserAgent: record.lastUserAgent ?? null,
      lastHostname: record.lastHostname ?? null,
      lastPlatform: record.lastPlatform ?? null,
      lastUser: record.lastUser ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
    },
  });
}
