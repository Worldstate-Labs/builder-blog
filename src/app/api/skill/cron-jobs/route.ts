import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, tooManyRequestsResponse } from "@/lib/rate-limit";
import { getUserFromBearer } from "@/lib/tokens";
import { formatZodError } from "@/lib/zod-error";

const cronFrequencies: Record<string, { intervalMinutes: number; label: string }> = {
  "1h": { intervalMinutes: 60, label: "Hourly" },
  daily: { intervalMinutes: 1_440, label: "Daily" },
  weekly: { intervalMinutes: 10_080, label: "Weekly" },
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
  ownerId: z.string().max(200).nullable().optional(),
});

const CronJobQuerySchema = z.object({
  job: z.enum(["library-cron", "digest-cron"]),
  ownerId: z.string().max(200).optional(),
  mode: z.enum(["state", "guard"]).optional(),
});

const CronJobDeleteSchema = z.object({
  job: z.enum(["library-cron", "digest-cron"]),
});

type LocalCronJobRecord = {
  id: string;
  status: string;
  startedAt: Date;
  stoppedAt: Date | null;
  frequencyKey: string;
  frequencyLabel: string;
  schedule: string;
  intervalMinutes: number;
  runtime: string | null;
  hostname: string | null;
  platform: string | null;
  ownerId: string | null;
  ownerHeartbeatAt: Date | null;
  overrideFetched?: boolean;
  regenerateDigest?: boolean;
};

function serializeCronJob(record: LocalCronJobRecord | null) {
  if (!record) return null;
  return {
    id: record.id,
    status: record.status,
    startedAt: record.startedAt.toISOString(),
    stoppedAt: record.stoppedAt?.toISOString() ?? null,
    frequencyKey: record.frequencyKey,
    frequencyLabel: record.frequencyLabel,
    schedule: record.schedule,
    intervalMinutes: record.intervalMinutes,
    runtime: record.runtime,
    hostname: record.hostname,
    platform: record.platform,
    ownerId: record.ownerId,
    ownerHeartbeatAt: record.ownerHeartbeatAt?.toISOString() ?? null,
    ...(record.overrideFetched === undefined ? {} : { overrideFetched: record.overrideFetched }),
    ...(record.regenerateDigest === undefined ? {} : { regenerateDigest: record.regenerateDigest }),
  };
}

async function findCronJob(userId: string, job: "library-cron" | "digest-cron") {
  return job === "digest-cron"
    ? prisma.digestCronJob.findUnique({ where: { userId } })
    : prisma.libraryCronJob.findUnique({ where: { userId } });
}

async function markCronJobStopped({
  job,
  userId,
}: {
  job: "library-cron" | "digest-cron";
  userId: string;
}) {
  const data = {
    status: "stopped",
    stoppedAt: new Date(),
    ownerHeartbeatAt: null,
  };
  return job === "digest-cron"
    ? prisma.digestCronJob.updateMany({ where: { userId }, data })
    : prisma.libraryCronJob.updateMany({ where: { userId }, data });
}

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

export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = CronJobQuerySchema.safeParse({
    job: url.searchParams.get("job"),
    ownerId: url.searchParams.get("ownerId") ?? undefined,
    mode: url.searchParams.get("mode") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const { job, ownerId, mode = "state" } = parsed.data;
  const current = await findCronJob(user.id, job);
  if (mode !== "guard") {
    return NextResponse.json({ job: serializeCronJob(current) });
  }

  if (!ownerId) {
    return NextResponse.json({
      decision: "stop",
      reason: "missing_owner_id",
      job: serializeCronJob(current),
    });
  }

  if (!current) {
    return NextResponse.json({
      decision: "stop",
      reason: "missing_server_schedule",
      job: null,
    });
  }

  if (current.status !== "active") {
    return NextResponse.json({
      decision: "stop",
      reason: "server_stopped",
      job: serializeCronJob(current),
    });
  }

  if (current.ownerId && current.ownerId !== ownerId) {
    return NextResponse.json({
      decision: "stop",
      reason: "owner_changed",
      job: serializeCronJob(current),
    });
  }

  const data = {
    ownerId,
    ownerHeartbeatAt: new Date(),
    hostname: request.headers.get("x-machine-hostname"),
    platform: request.headers.get("x-machine-platform"),
  };
  const guarded = job === "digest-cron"
    ? await prisma.digestCronJob.updateMany({
        where: {
          userId: user.id,
          status: "active",
          ...(current.ownerId ? { ownerId } : { ownerId: null }),
        },
        data,
      })
    : await prisma.libraryCronJob.updateMany({
        where: {
          userId: user.id,
          status: "active",
          ...(current.ownerId ? { ownerId } : { ownerId: null }),
        },
        data,
      });
  if (guarded.count === 0) {
    const latest = await findCronJob(user.id, job);
    return NextResponse.json({
      decision: "stop",
      reason: "owner_changed",
      job: serializeCronJob(latest),
    });
  }
  const next = await findCronJob(user.id, job);

  return NextResponse.json({
    decision: "run",
    reason: current.ownerId ? "owner_heartbeat" : "owner_claimed",
    job: serializeCronJob(next),
  });
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
    const stopped = await markCronJobStopped({ job: parsed.data.job, userId: user.id });
    await recordCronJobStatusEvent({
      request,
      userId: user.id,
      job: parsed.data.job,
      status: "stopped",
      runtime: parsed.data.runtime ?? null,
      details: { updated: stopped.count, ownerId: parsed.data.ownerId ?? null },
    });
    return NextResponse.json({ status: "stopped", updated: stopped.count });
  }

  const frequencyKey = parsed.data.frequencyKey ?? "";
  const frequency = Object.prototype.hasOwnProperty.call(cronFrequencies, frequencyKey)
    ? cronFrequencies[frequencyKey]
    : undefined;
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
        ownerId: parsed.data.ownerId ?? null,
        ownerHeartbeatAt: parsed.data.ownerId ? new Date() : null,
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
        ownerId: parsed.data.ownerId ?? null,
        ownerHeartbeatAt: parsed.data.ownerId ? new Date() : null,
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
        ownerId: record.ownerId,
      },
    });

    return NextResponse.json({
      job: serializeCronJob(record),
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
      ownerId: parsed.data.ownerId ?? null,
      ownerHeartbeatAt: parsed.data.ownerId ? new Date() : null,
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
      ownerId: parsed.data.ownerId ?? null,
      ownerHeartbeatAt: parsed.data.ownerId ? new Date() : null,
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
      ownerId: record.ownerId,
    },
  });

  return NextResponse.json({
    job: serializeCronJob(record),
  });
}

export async function DELETE(request: Request) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = CronJobDeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const stopped = await markCronJobStopped({ job: parsed.data.job, userId: session.user.id });
  await recordCronJobStatusEvent({
    request,
    userId: session.user.id,
    job: parsed.data.job,
    status: "stopped",
    runtime: null,
    details: { updated: stopped.count, source: "web_stop" },
  });
  return NextResponse.json({ status: "stopped", updated: stopped.count });
}
