import { NextResponse } from "next/server";
import { importFollowBuildersFeeds, seedDefaultBuilderPool } from "@/lib/builders";
import { isCronAuthorized } from "@/lib/cron-auth";
import { shouldImportFollowBuildersFallback } from "@/lib/crawl-fallback";
import { crawlBuilderPool } from "@/lib/crawler";

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const seeded = await seedDefaultBuilderPool();
  const crawled = await crawlBuilderPool();
  const fallbackImported = shouldImportFollowBuildersFallback(crawled)
    ? await importFollowBuildersFeeds().catch((error: unknown) => ({
        error: error instanceof Error ? error.message : "Unknown fallback import error",
      }))
    : null;

  return NextResponse.json({ status: "ok", seeded, crawled, fallbackImported });
}

export async function GET(request: Request) {
  return POST(request);
}
