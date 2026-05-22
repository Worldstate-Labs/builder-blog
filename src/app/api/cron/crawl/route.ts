import { NextResponse } from "next/server";
import { seedDefaultBuilderPool } from "@/lib/builders";
import { isCronAuthorized } from "@/lib/cron-auth";
import { crawlBuilderPool } from "@/lib/crawler";

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const seeded = await seedDefaultBuilderPool();
  const crawled = await crawlBuilderPool();

  return NextResponse.json({ status: "ok", seeded, crawled });
}

export async function GET(request: Request) {
  return POST(request);
}
