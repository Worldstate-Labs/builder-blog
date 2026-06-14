import { NextResponse } from "next/server";
import { getAgentJobRuns, getScheduledAgentJobRuns } from "@/lib/agent-job-runs";
import { getCurrentSession } from "@/lib/auth";
import { getDigestRuns, serializeDigestCronJob } from "@/lib/digest-runs";
import { prisma } from "@/lib/prisma";
import { getUserFromBearer } from "@/lib/tokens";

// Read-only digest log for the signed-in user: every digest generation,
// newest first, including empty "no new updates" runs. Backs the client
// background refresh on DigestLogPanel; the initial render is server-fetched.
export async function GET(request: Request) {
  const session = await getCurrentSession();
  const bearerUser = session?.user?.id ? null : await getUserFromBearer(request);
  const userId = session?.user?.id ?? bearerUser?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [runs, cronRuns, cronJob, jobRuns, scheduledJobRuns] = await Promise.all([
    getDigestRuns(userId),
    getDigestRuns(userId, 25, "cron"),
    prisma.digestCronJob.findUnique({ where: { userId } }),
    // getAgentJobRuns wraps prisma.agentJobRun.findMany for all digest runtime instances.
    getAgentJobRuns(userId, "digest-build", 25),
    getScheduledAgentJobRuns(userId, "digest-cron", 25),
  ]);
  return NextResponse.json({
    runs,
    cronRuns,
    cronJob: serializeDigestCronJob(cronJob),
    jobRuns,
    scheduledJobRuns,
  });
}
