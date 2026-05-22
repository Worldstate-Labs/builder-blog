import { BuilderScope } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromBearer } from "@/lib/tokens";

const DIGEST_PROMPTS = {
  digest:
    "Create a concise AI-builder digest in Chinese. Use only the supplied items. Group by source type and builder. Include source URLs for every claim. Highlight launches, technical insights, funding/business moves, strong opinions, and implementation details. Do not invent missing facts.",
  summarizeTweets:
    "Summarize recent X posts from an AI builder for a busy professional. Introduce the author by full name and role/company when known. Include only substantive opinions, insights, launches, technical discussion, analysis, or lessons. Skip mundane posts, bare retweets, weak promotion, and engagement bait. Write 2-4 sentences per builder, lead with bold or contrarian takes, and include direct tweet URLs.",
  summarizePodcast:
    "Remix a podcast transcript into 200-400 sharp words. Start with a one-sentence takeaway, explain the speaker context, prioritize counterintuitive or specific insights, include a memorable direct quote when present in the supplied transcript, avoid filler like 'in this episode', and include the specific episode URL.",
  summarizeBlogs:
    "Summarize AI company blog posts in 100-300 words. Start with the blog name and article title, lead with the core announcement or insight, include product names, numbers, benchmarks, practical implications, and a direct quote only when it appears in the supplied text. Include the direct article URL.",
  digestIntro:
    "Assemble the final digest in this order: X / Twitter, Official Blogs, Podcasts. Include only sources with new content. Every item must keep its original source URL. For podcasts, use the specific episode/video URL, not a channel page. For tweets, do not prefix handles with @. Never fabricate quotes, opinions, or facts.",
  translate:
    "Translate the final digest into natural simplified Chinese while keeping common technical terms in English when Chinese AI professionals would use them. Keep names, companies, products, tools, and URLs unchanged. Maintain structure and formatting. Tone: professional but conversational, like a knowledgeable friend briefing you.",
};

export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "1");
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);

  const builders = await prisma.builder.findMany({
    where: {
      OR: [
        { scope: BuilderScope.CENTRAL },
        { scope: BuilderScope.PERSONAL, ownerUserId: user.id },
      ],
    },
    orderBy: [{ scope: "asc" }, { kind: "asc" }, { name: "asc" }],
  });
  const builderIds = builders.map((builder) => builder.id);

  const items = await prisma.feedItem.findMany({
    where: {
      builderId: { in: builderIds },
      OR: [{ publishedAt: { gte: since } }, { createdAt: { gte: since } }],
    },
    include: { builder: true },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 80,
  });

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
    generatedAt: new Date().toISOString(),
    language: "zh",
    subscriptions: builders,
    libraryBuilders: builders,
    items,
    prompts: DIGEST_PROMPTS,
  });
}
