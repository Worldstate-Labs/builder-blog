import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getDigestRuns } from "@/lib/digest-runs";

// Read-only digest log for the signed-in user: every digest generation,
// newest first, including empty "no new updates" runs. Backs the client
// refresh button on DigestLogPanel; the initial render is server-fetched.
export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const runs = await getDigestRuns(session.user.id);
  return NextResponse.json({ runs });
}
