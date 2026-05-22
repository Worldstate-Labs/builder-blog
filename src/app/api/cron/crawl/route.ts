import { NextResponse } from "next/server";
import { crawlCentralFeeds, seedDefaultBuilderPool } from "@/lib/builders";

function assertCronAuth(request: Request) {
  const configured = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  return configured && auth === `Bearer ${configured}`;
}

export async function POST(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const seeded = await seedDefaultBuilderPool();
  const crawled = await crawlCentralFeeds();

  return NextResponse.json({ status: "ok", seeded, crawled });
}

export async function GET(request: Request) {
  return POST(request);
}
