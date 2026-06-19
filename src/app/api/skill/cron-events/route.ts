import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { getUserFromBearer } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";

const MAX_DETAILS_BYTES = 50_000;

const CronJobStatusEventSchema = z.object({
  job: z.enum(["library-cron", "digest-cron"]),
  eventType: z.string().min(1).max(80),
  status: z.enum(["active", "stopped"]).nullable().optional(),
  reason: z.string().max(240).nullable().optional(),
  runtime: z.string().max(80).nullable().optional(),
  localLabel: z.string().max(160).nullable().optional(),
  localPlistExists: z.boolean().nullable().optional(),
  launchctlLoaded: z.boolean().nullable().optional(),
  details: z.unknown().optional(),
});

export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = rateLimit({
    key: `skill-cron-events:${user.id}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return tooManyRequestsResponse(limit.retryAfterMs);
  }

  const parsed = CronJobStatusEventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const detailsValue = (parsed.data.details ?? {}) as Prisma.InputJsonValue;
  let detailsJson = "";
  try {
    detailsJson = JSON.stringify(detailsValue);
  } catch {
    return NextResponse.json({ error: "details must be JSON-serializable" }, { status: 400 });
  }
  if (Buffer.byteLength(detailsJson, "utf8") > MAX_DETAILS_BYTES) {
    return NextResponse.json({ error: "details payload too large; cap at 50 KB" }, { status: 400 });
  }

  const record = await prisma.cronJobStatusEvent.create({
    data: {
      userId: user.id,
      job: parsed.data.job,
      eventType: parsed.data.eventType,
      status: parsed.data.status ?? null,
      reason: parsed.data.reason ?? null,
      runtime: parsed.data.runtime ?? null,
      hostname: request.headers.get("x-machine-hostname"),
      platform: request.headers.get("x-machine-platform"),
      localLabel: parsed.data.localLabel ?? null,
      localPlistExists: parsed.data.localPlistExists ?? null,
      launchctlLoaded: parsed.data.launchctlLoaded ?? null,
      details: detailsValue,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: record.id });
}
