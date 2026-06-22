import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { getUserFromBearer } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";

const cronFrequencies: Record<string, { intervalMinutes: number; label: string }> = {
  "30m": { intervalMinutes: 30, label: "every 30 minutes" },
  "1h": { intervalMinutes: 60, label: "every hour" },
  "3h": { intervalMinutes: 180, label: "every 3 hours" },
  "6h": { intervalMinutes: 360, label: "every 6 hours" },
  "12h": { intervalMinutes: 720, label: "every 12 hours" },
  daily: { intervalMinutes: 1_440, label: "every day" },
  weekly: { intervalMinutes: 10_080, label: "every week" },
};

const CronJobSchema = z.object({
  job: z.enum(["library-cron", "digest-cron"]),
  status: z.enum(["active", "stopped"]),
  frequencyKey: z.string().optional(),
  frequencyLabel: z.string().max(80).optional(),
  schedule: z.string().max(80).optional(),
  runtime: z.string().max(40).nullable().optional(),
  overrideFetched: z.boolean().optional(),
  regenerateDigest: z.boolean().optional(),
  startedAt: z.string().datetime().optional(),
});

async function recordCronJobStatusEvent({
  request,
  userId,
  job,
  status,
  runtime,
  details,
}: {
  request: Request;
  userId: string;
  job: z.infer<typeof CronJobSchema>["job"];
  status: z.infer<typeof CronJobSchema>["status"];
  runtime: string | null;
  details: Prisma.InputJsonValue;
}) {
  try {
    await prisma.cronJobStatusEvent.create({
      data: {
        userId,
        job,
        eventType: "cron_status_applied",
        status,
        runtime,
        hostname: request.headers.get("x-machine-hostname"),
        platform: request.headers.get("x-machine-platform"),
        details,
      },
    });
  } catch (error) {
    console.error("Failed to record cron job status event", error);
  }
}

export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = rateLimit({
    key: `skill-cron-jobs:${user.id}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return tooManyRequestsResponse(limit.retryAfterMs);
  }

  const parsed = CronJobSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const isDigestCron = parsed.data.job === "digest-cron";

  if (parsed.data.status === "stopped") {
    if (isDigestCron) {
      const stopped = await prisma.digestCronJob.updateMany({
        where: { userId: user.id },
        data: { status: "stopped", stoppedAt: new Date() },
      });
      await recordCronJobStatusEvent({
        request,
        userId: user.id,
        job: parsed.data.job,
        status: "stopped",
        runtime: parsed.data.runtime ?? null,
        details: { updated: stopped.count },
      });
      return NextResponse.json({ status: "stopped", updated: stopped.count });
    }
    const stopped = await prisma.libraryCronJob.updateMany({
      where: { userId: user.id },
      data: { status: "stopped", stoppedAt: new Date() },
    });
    await recordCronJobStatusEvent({
      request,
      userId: user.id,
      job: parsed.data.job,
      status: "stopped",
      runtime: parsed.data.runtime ?? null,
      details: { updated: stopped.count },
    });
    return NextResponse.json({ status: "stopped", updated: stopped.count });
  }

  const frequencyKey = parsed.data.frequencyKey ?? "";
  const frequency = cronFrequencies[frequencyKey];
  if (!frequency || !parsed.data.schedule) {
    return NextResponse.json(
      { error: "Active cron jobs require a supported frequencyKey and schedule" },
      { status: 400 },
    );
  }

  const startedAt = parsed.data.startedAt ? new Date(parsed.data.startedAt) : new Date();
  if (isDigestCron) {
    const record = await prisma.digestCronJob.upsert({
      where: { userId: user.id },
      update: {
        status: "active",
        stoppedAt: null,
        startedAt,
        frequencyKey,
        frequencyLabel: parsed.data.frequencyLabel || frequency.label,
        schedule: parsed.data.schedule,
        intervalMinutes: frequency.intervalMinutes,
        runtime: parsed.data.runtime || null,
        regenerateDigest: Boolean(parsed.data.regenerateDigest),
        hostname: request.headers.get("x-machine-hostname"),
        platform: request.headers.get("x-machine-platform"),
      },
      create: {
        userId: user.id,
        status: "active",
        startedAt,
        frequencyKey,
        frequencyLabel: parsed.data.frequencyLabel || frequency.label,
        schedule: parsed.data.schedule,
        intervalMinutes: frequency.intervalMinutes,
        runtime: parsed.data.runtime || null,
        regenerateDigest: Boolean(parsed.data.regenerateDigest),
        hostname: request.headers.get("x-machine-hostname"),
        platform: request.headers.get("x-machine-platform"),
      },
    });

    await recordCronJobStatusEvent({
      request,
      userId: user.id,
      job: parsed.data.job,
      status: "active",
      runtime: parsed.data.runtime ?? null,
      details: {
        frequencyKey,
        frequencyLabel: record.frequencyLabel,
        schedule: record.schedule,
        intervalMinutes: record.intervalMinutes,
        regenerateDigest: record.regenerateDigest,
      },
    });

    return NextResponse.json({
      job: {
        id: record.id,
        status: record.status,
        startedAt: record.startedAt.toISOString(),
        frequencyKey: record.frequencyKey,
        frequencyLabel: record.frequencyLabel,
        schedule: record.schedule,
        intervalMinutes: record.intervalMinutes,
        runtime: record.runtime,
        regenerateDigest: record.regenerateDigest,
      },
    });
  }

  const record = await prisma.libraryCronJob.upsert({
    where: { userId: user.id },
    update: {
      status: "active",
      stoppedAt: null,
      startedAt,
      frequencyKey,
      frequencyLabel: parsed.data.frequencyLabel || frequency.label,
      schedule: parsed.data.schedule,
      intervalMinutes: frequency.intervalMinutes,
      runtime: parsed.data.runtime || null,
      overrideFetched: Boolean(parsed.data.overrideFetched),
      hostname: request.headers.get("x-machine-hostname"),
      platform: request.headers.get("x-machine-platform"),
    },
    create: {
      userId: user.id,
      status: "active",
      startedAt,
      frequencyKey,
      frequencyLabel: parsed.data.frequencyLabel || frequency.label,
      schedule: parsed.data.schedule,
      intervalMinutes: frequency.intervalMinutes,
      runtime: parsed.data.runtime || null,
      overrideFetched: Boolean(parsed.data.overrideFetched),
      hostname: request.headers.get("x-machine-hostname"),
      platform: request.headers.get("x-machine-platform"),
    },
  });

  await recordCronJobStatusEvent({
    request,
    userId: user.id,
    job: parsed.data.job,
    status: "active",
    runtime: parsed.data.runtime ?? null,
    details: {
      frequencyKey,
      frequencyLabel: record.frequencyLabel,
      schedule: record.schedule,
      intervalMinutes: record.intervalMinutes,
      overrideFetched: record.overrideFetched,
    },
  });

  return NextResponse.json({
    job: {
      id: record.id,
      status: record.status,
      startedAt: record.startedAt.toISOString(),
      frequencyKey: record.frequencyKey,
      frequencyLabel: record.frequencyLabel,
      schedule: record.schedule,
      intervalMinutes: record.intervalMinutes,
      runtime: record.runtime,
      overrideFetched: record.overrideFetched,
    },
  });
}
