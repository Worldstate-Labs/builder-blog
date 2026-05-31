import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getDigestRuns, serializeDigestCronJob } from "@/lib/digest-runs";
import { prisma } from "@/lib/prisma";

// Read-only digest log for the signed-in user: every digest generation,
// newest first, including empty "no new updates" runs. Backs the client
// background refresh on DigestLogPanel; the initial render is server-fetched.
export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [runs, cronRuns, cronJob] = await Promise.all([
    getDigestRuns(session.user.id),
    getDigestRuns(session.user.id, 25, "cron"),
    prisma.digestCronJob.findUnique({ where: { userId: session.user.id } }),
  ]);
  return NextResponse.json({ runs, cronRuns, cronJob: serializeDigestCronJob(cronJob) });
}
