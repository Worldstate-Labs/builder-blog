import { canonicalBuilderKey, normalizeHandle } from "@/lib/builder-keys";
import { prisma } from "@/lib/prisma";
import type { SourceCandidate } from "@/lib/source-candidates";
import { builderKindForSourceType } from "@/lib/source-registry";

const ADMIN_SOURCE_CANDIDATE_SEED = "admin_source_library";
const CURATED_AI_SOURCE_CANDIDATE_SEED = "curated_ai_sources";
const SOURCE_CANDIDATE_LIMIT = 300;
const SOURCE_CANDIDATE_SEED_TTL_MS = 5 * 60 * 1000;

let sourceCandidateSeedPromise: Promise<void> | null = null;
let sourceCandidateSeededAt = 0;

type CuratedSourceCandidate = {
  name: string;
  sourceType: string;
  sourceUrl: string;
  avatarDomain?: string | null;
  avatarUrl?: string | null;
  fetchUrl?: string | null;
  handle?: string | null;
};

const CURATED_AI_SOURCE_CANDIDATES: CuratedSourceCandidate[] = [
  { name: "OpenAI News", sourceType: "blog", sourceUrl: "https://openai.com/news/rss.xml", fetchUrl: "https://openai.com/news/rss.xml" },
  { name: "Anthropic Engineering", sourceType: "blog", sourceUrl: "https://www.anthropic.com/engineering" },
  { name: "Claude Blog", sourceType: "blog", sourceUrl: "https://claude.com/blog" },
  { name: "GitHub Trending", sourceType: "github_trending", sourceUrl: "https://github.com/trending?since=daily", fetchUrl: "https://github.com/trending?since=daily" },
  { name: "Product Hunt Top Products", sourceType: "product_hunt_top_products", sourceUrl: "https://www.producthunt.com/", fetchUrl: "https://www.producthunt.com/" },
  { name: "Anthropic News", sourceType: "blog", sourceUrl: "https://www.anthropic.com/news" },
  { name: "Google DeepMind Blog", sourceType: "blog", sourceUrl: "https://deepmind.google/blog/" },
  { name: "Google Research Blog", sourceType: "blog", sourceUrl: "https://research.google/blog/" },
  { name: "Meta AI Blog", sourceType: "blog", sourceUrl: "https://ai.meta.com/blog/" },
  { name: "Hugging Face Blog", sourceType: "blog", sourceUrl: "https://huggingface.co/blog/feed.xml", fetchUrl: "https://huggingface.co/blog/feed.xml" },
  { name: "Mistral AI News", sourceType: "blog", sourceUrl: "https://mistral.ai/rss.xml", fetchUrl: "https://mistral.ai/rss.xml" },
  { name: "Cohere Blog", sourceType: "blog", sourceUrl: "https://cohere.com/blog" },
  { name: "Microsoft AI Blog", sourceType: "blog", sourceUrl: "https://news.microsoft.com/source/topics/ai/feed/", fetchUrl: "https://news.microsoft.com/source/topics/ai/feed/" },
  { name: "AWS Machine Learning Blog", sourceType: "blog", sourceUrl: "https://aws.amazon.com/blogs/machine-learning/feed/", fetchUrl: "https://aws.amazon.com/blogs/machine-learning/feed/" },
  { name: "ElevenLabs Blog", sourceType: "blog", sourceUrl: "https://elevenlabs.io/blog" },
  { name: "Stability AI News", sourceType: "blog", sourceUrl: "https://stability.ai/news-updates" },
  { name: "LangChain Blog", sourceType: "blog", sourceUrl: "https://www.langchain.com/blog" },
  { name: "LlamaIndex Blog", sourceType: "blog", sourceUrl: "https://www.llamaindex.ai/blog" },
  { name: "Vercel AI Blog", sourceType: "blog", sourceUrl: "https://vercel.com/blog?tag=ai" },
  { name: "Replicate Blog", sourceType: "blog", sourceUrl: "https://replicate.com/blog" },
  { name: "Together AI Blog", sourceType: "blog", sourceUrl: "https://www.together.ai/blog/rss.xml", fetchUrl: "https://www.together.ai/blog/rss.xml" },
  { name: "Modal Blog", sourceType: "blog", sourceUrl: "https://modal.com/blog/atom.xml", fetchUrl: "https://modal.com/blog/atom.xml" },
  { name: "Cursor Blog", sourceType: "blog", sourceUrl: "https://cursor.com/blog" },
  { name: "arXiv AI Papers", sourceType: "blog", sourceUrl: "https://rss.arxiv.org/rss/cs.AI", fetchUrl: "https://rss.arxiv.org/rss/cs.AI", avatarDomain: "arxiv.org" },
  { name: "arXiv NLP Papers", sourceType: "blog", sourceUrl: "https://rss.arxiv.org/rss/cs.CL", fetchUrl: "https://rss.arxiv.org/rss/cs.CL", avatarDomain: "arxiv.org" },
  { name: "arXiv Machine Learning Papers", sourceType: "blog", sourceUrl: "https://rss.arxiv.org/rss/cs.LG", fetchUrl: "https://rss.arxiv.org/rss/cs.LG", avatarDomain: "arxiv.org" },
  { name: "The Gradient", sourceType: "blog", sourceUrl: "https://thegradient.pub/rss/", fetchUrl: "https://thegradient.pub/rss/" },
  { name: "Lil'Log by Lilian Weng", sourceType: "blog", sourceUrl: "https://lilianweng.github.io/lil-log/feed.xml", fetchUrl: "https://lilianweng.github.io/lil-log/feed.xml" },
  { name: "Ahead of AI", sourceType: "blog", sourceUrl: "https://magazine.sebastianraschka.com/feed", fetchUrl: "https://magazine.sebastianraschka.com/feed" },
  { name: "Latent Space", sourceType: "blog", sourceUrl: "https://www.latent.space/feed", fetchUrl: "https://www.latent.space/feed" },
  { name: "The Batch by DeepLearning.AI", sourceType: "blog", sourceUrl: "https://www.deeplearning.ai/the-batch/" },
  { name: "Interconnects", sourceType: "blog", sourceUrl: "https://www.interconnects.ai/feed", fetchUrl: "https://www.interconnects.ai/feed" },
  { name: "Simon Willison's Weblog", sourceType: "blog", sourceUrl: "https://simonwillison.net/atom/everything/", fetchUrl: "https://simonwillison.net/atom/everything/" },
  { name: "No Priors", sourceType: "podcast", sourceUrl: "https://feeds.megaphone.fm/nopriors", fetchUrl: "https://feeds.megaphone.fm/nopriors", avatarDomain: "nopriorspodcast.com" },
  { name: "Practical AI Podcast", sourceType: "podcast", sourceUrl: "https://feeds.transistor.fm/practical-ai-machine-learning-data-science-llm", fetchUrl: "https://feeds.transistor.fm/practical-ai-machine-learning-data-science-llm", avatarDomain: "practicalai.fm" },
  { name: "Latent Space Podcast", sourceType: "podcast", sourceUrl: "https://api.substack.com/feed/podcast/1084089.rss", fetchUrl: "https://api.substack.com/feed/podcast/1084089.rss", avatarDomain: "www.latent.space" },
  { name: "The Cognitive Revolution", sourceType: "podcast", sourceUrl: "https://www.cognitiverevolution.ai/latest/rss/", fetchUrl: "https://www.cognitiverevolution.ai/latest/rss/" },
  { name: "MIT Technology Review AI", sourceType: "blog", sourceUrl: "https://www.technologyreview.com/topic/artificial-intelligence/feed/", fetchUrl: "https://www.technologyreview.com/topic/artificial-intelligence/feed/" },
  { name: "The Verge AI", sourceType: "blog", sourceUrl: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", fetchUrl: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "TechCrunch AI", sourceType: "blog", sourceUrl: "https://techcrunch.com/category/artificial-intelligence/feed/", fetchUrl: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "VentureBeat AI", sourceType: "blog", sourceUrl: "https://venturebeat.com/category/ai/feed/", fetchUrl: "https://venturebeat.com/category/ai/feed/" },
  { name: "Ars Technica AI", sourceType: "blog", sourceUrl: "https://arstechnica.com/ai/feed/", fetchUrl: "https://arstechnica.com/ai/feed/" },
  { name: "The Decoder", sourceType: "blog", sourceUrl: "https://the-decoder.com/feed/", fetchUrl: "https://the-decoder.com/feed/" },
  { name: "MarkTechPost", sourceType: "blog", sourceUrl: "https://www.marktechpost.com/feed/", fetchUrl: "https://www.marktechpost.com/feed/" },
  { name: "Last Week in AI", sourceType: "blog", sourceUrl: "https://lastweekin.ai/feed/", fetchUrl: "https://lastweekin.ai/feed/" },
  { name: "AI Weekly", sourceType: "blog", sourceUrl: "https://aiweekly.co/issues.rss", fetchUrl: "https://aiweekly.co/issues.rss" },
  { name: "Import AI", sourceType: "blog", sourceUrl: "https://importai.substack.com/feed", fetchUrl: "https://importai.substack.com/feed" },
  { name: "BAIR Blog", sourceType: "blog", sourceUrl: "https://bair.berkeley.edu/blog/feed.xml", fetchUrl: "https://bair.berkeley.edu/blog/feed.xml" },
  { name: "Stanford AI Lab Blog", sourceType: "blog", sourceUrl: "https://ai.stanford.edu/blog/feed.xml", fetchUrl: "https://ai.stanford.edu/blog/feed.xml" },
  { name: "Weaviate Blog", sourceType: "blog", sourceUrl: "https://weaviate.io/blog/rss.xml", fetchUrl: "https://weaviate.io/blog/rss.xml" },
  { name: "EleutherAI Blog", sourceType: "blog", sourceUrl: "https://blog.eleuther.ai/index.xml", fetchUrl: "https://blog.eleuther.ai/index.xml" },
  { name: "OpenRouter Blog", sourceType: "blog", sourceUrl: "https://openrouter.ai/blog/feed.xml", fetchUrl: "https://openrouter.ai/blog/feed.xml" },
  { name: "Aider Blog", sourceType: "blog", sourceUrl: "https://aider.chat/feed.xml", fetchUrl: "https://aider.chat/feed.xml" },
  { name: "DeepLearning.AI Blog", sourceType: "website", sourceUrl: "https://www.deeplearning.ai/blog/" },
  { name: "Anthropic Research", sourceType: "website", sourceUrl: "https://www.anthropic.com/research" },
  { name: "Weights & Biases Articles", sourceType: "website", sourceUrl: "https://wandb.ai/site/articles/" },
  { name: "AssemblyAI Blog", sourceType: "website", sourceUrl: "https://www.assemblyai.com/blog/" },
  { name: "Pinecone Learn", sourceType: "website", sourceUrl: "https://www.pinecone.io/learn/" },
  { name: "Qdrant Blog", sourceType: "website", sourceUrl: "https://qdrant.tech/blog/" },
  { name: "LMSYS Blog", sourceType: "website", sourceUrl: "https://www.lmsys.org/blog/" },
  { name: "Dwarkesh Podcast", sourceType: "podcast", sourceUrl: "https://www.dwarkesh.com/feed", fetchUrl: "https://www.dwarkesh.com/feed" },
  { name: "AI Engineering Podcast", sourceType: "podcast", sourceUrl: "https://serve.podhome.fm/rss/c9abdd38-a5dc-5eb2-96fd-f833f93208a7", fetchUrl: "https://serve.podhome.fm/rss/c9abdd38-a5dc-5eb2-96fd-f833f93208a7", avatarDomain: "ai.engineer" },
  { name: "OpenAI YouTube", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@OpenAI", avatarUrl: "https://yt3.googleusercontent.com/MopgmVAFV9BqlzOJ-UINtmutvEPcNe5IbKMmP_4vZZo3vnJXcZGtybUBsXaEVxkmxKyGqX9R=s900-c-k-c0x00ffffff-no-rj" },
  { name: "Google DeepMind YouTube", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@GoogleDeepMind", avatarUrl: "https://yt3.googleusercontent.com/xofhdRNoyqgAB_YpJgAQeasGtE6gTEXpR2v1vyMmtqlRCmoEUIsTGJcavUORLhhKQk3b9UeUFw=s900-c-k-c0x00ffffff-no-rj" },
  { name: "Andrej Karpathy YouTube", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@AndrejKarpathy", avatarUrl: "https://yt3.googleusercontent.com/ytc/AIdro_nDvyq2NoPL626bk1IbxQ94SfQsD-B0qgZchghtQNkLWoEz=s900-c-k-c0x00ffffff-no-rj" },
  { name: "Yannic Kilcher", sourceType: "youtube", sourceUrl: "https://www.youtube.com/c/YannicKilcher", avatarUrl: "https://yt3.googleusercontent.com/ytc/AIdro_nqmmpWC-iPIeVF4grbJGcGmoWyYX0E6_PFGITlKv7jTMrh=s900-c-k-c0x00ffffff-no-rj" },
  { name: "Two Minute Papers", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@TwoMinutePapers", avatarUrl: "https://yt3.googleusercontent.com/ytc/AIdro_ljAkSpv16cJNUsE_rI1X-Kz9s78w1WNojUga-aZ1uVzEQ=s900-c-k-c0x00ffffff-no-rj" },
  { name: "AI Explained", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@aiexplained-official", avatarUrl: "https://yt3.googleusercontent.com/GFuvgO3IZvs5XkYOxyLoWQto2lyY6-7Ob-7sfZRyoann4eBgvBMxuGgSVU1cvBgRCgAn41St7g=s900-c-k-c0x00ffffff-no-rj" },
  { name: "DeepLearning.AI YouTube", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@Deeplearningai", avatarUrl: "https://yt3.googleusercontent.com/ytc/AIdro_nS1r8vYA9YVt1AQB355iMbBJNMg0OJn0I4J53_4T9xAes=s900-c-k-c0x00ffffff-no-rj" },
  { name: "Machine Learning Street Talk", sourceType: "youtube", sourceUrl: "https://www.youtube.com/c/machinelearningstreettalk", avatarUrl: "https://yt3.googleusercontent.com/15Akj76BG8IsM5ctgqVwKXArl6IfIVFAbuGa1kOomoioRgJgXHHaLmMAW7iHTMRUoEfyjTtq8lg=s900-c-k-c0x00ffffff-no-rj" },
  { name: "Computerphile", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@Computerphile", avatarUrl: "https://yt3.googleusercontent.com/ebHMyRfch3u2UTZN1WQJDp9J5U7o38T_WnGkd2QhAIQwBgvozdaOCOnfDMtngtoHWutJvLl4i0c=s900-c-k-c0x00ffffff-no-rj" },
  { name: "IBM Technology", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@IBMTechnology", avatarUrl: "https://yt3.googleusercontent.com/7qCmNHAsFvD6RSINuJ1WoGZYoKmm7TDnhORKFqLb8QoeOFh2qFXal8brkzoxNrwqmJTuvOLs=s900-c-k-c0x00ffffff-no-rj" },
  { name: "3Blue1Brown", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@3blue1brown", avatarUrl: "https://yt3.googleusercontent.com/ytc/AIdro_nFzZFPLxPZRHcE3SSwzdrbuWqfoWYwLAu0_2iO6blQYAU=s900-c-k-c0x00ffffff-no-rj" },
  { name: "Andrej Karpathy on X", sourceType: "x", sourceUrl: "https://x.com/karpathy", handle: "karpathy", avatarUrl: "https://pbs.twimg.com/profile_images/1296667294148382721/9Pr6XrPB_200x200.jpg" },
  { name: "Google Labs on X", sourceType: "x", sourceUrl: "https://x.com/googlelabs", handle: "googlelabs", avatarUrl: "https://pbs.twimg.com/profile_images/1792661411102863360/fzzB7K-f_200x200.png" },
  { name: "OpenAI on X", sourceType: "x", sourceUrl: "https://x.com/OpenAI", handle: "OpenAI", avatarUrl: "https://pbs.twimg.com/profile_images/1885410181409820672/ztsaR0JW_200x200.jpg" },
  { name: "Anthropic on X", sourceType: "x", sourceUrl: "https://x.com/AnthropicAI", handle: "AnthropicAI", avatarUrl: "https://pbs.twimg.com/profile_images/1798110641414443008/XP8gyBaY_200x200.jpg" },
  { name: "Google DeepMind on X", sourceType: "x", sourceUrl: "https://x.com/GoogleDeepMind", handle: "GoogleDeepMind", avatarUrl: "https://pbs.twimg.com/profile_images/1695024885070737408/-M-HSH5P_200x200.jpg" },
  { name: "Meta AI on X", sourceType: "x", sourceUrl: "https://x.com/AIatMeta", handle: "AIatMeta", avatarUrl: "https://pbs.twimg.com/profile_images/1454145678075117568/2qXqM_Cu_200x200.png" },
  { name: "Hugging Face on X", sourceType: "x", sourceUrl: "https://x.com/huggingface", handle: "huggingface", avatarUrl: "https://pbs.twimg.com/profile_images/1991559933473497089/mbrRS49P_200x200.jpg" },
  { name: "Andrew Ng on X", sourceType: "x", sourceUrl: "https://x.com/AndrewYNg", handle: "AndrewYNg", avatarUrl: "https://pbs.twimg.com/profile_images/733174243714682880/oyG30NEH_200x200.jpg" },
  { name: "Ethan Mollick on X", sourceType: "x", sourceUrl: "https://x.com/emollick", handle: "emollick", avatarUrl: "https://pbs.twimg.com/profile_images/1601382188712398850/3AAOlqrX_200x200.jpg" },
];

type BuilderSeedSource = {
  id: string;
  canonicalKey: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
};

export async function ensureSourceCandidateLibraryFromAdminSources() {
  await ensureSourceCandidateSeeded();
  return listSourceCandidates();
}

async function ensureSourceCandidateSeeded() {
  const now = Date.now();
  if (
    sourceCandidateSeedPromise &&
    now - sourceCandidateSeededAt < SOURCE_CANDIDATE_SEED_TTL_MS
  ) {
    return sourceCandidateSeedPromise;
  }
  sourceCandidateSeedPromise = seedSourceCandidateLibrary().catch((error) => {
    sourceCandidateSeedPromise = null;
    throw error;
  });
  await sourceCandidateSeedPromise;
  sourceCandidateSeededAt = Date.now();
}

async function seedSourceCandidateLibrary() {
  await seedSourceCandidatesFromAdminLibrary();
  await seedCuratedAiSourceCandidates();
}

export async function listSourceCandidates(): Promise<SourceCandidate[]> {
  const candidates = await prisma.sourceCandidate.findMany({
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    take: SOURCE_CANDIDATE_LIMIT,
  });
  return candidates.map(serializeSourceCandidate);
}

async function seedSourceCandidatesFromAdminLibrary() {
  const adminLibrary = await prisma.libraryHubEntry.findFirst({
    where: { isFeatured: true },
    include: {
      items: {
        include: { builder: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!adminLibrary) return;

  const seeds = adminLibrary.items.map((item) => seedFromBuilder(item.builder));
  const uniqueSeeds = Array.from(
    new Map(seeds.map((seed) => [seed.sourceKey, seed])).values(),
  );
  if (uniqueSeeds.length === 0) return;

  const existingCandidates = await prisma.sourceCandidate.findMany({
    where: { sourceKey: { in: uniqueSeeds.map((seed) => seed.sourceKey) } },
    select: { sourceKey: true, seededFrom: true },
  });
  const existingByKey = new Map(
    existingCandidates.map((candidate) => [candidate.sourceKey, candidate]),
  );

  await Promise.all(
    uniqueSeeds.map((seed) => {
      const existing = existingByKey.get(seed.sourceKey);
      if (existing && existing.seededFrom !== ADMIN_SOURCE_CANDIDATE_SEED) {
        return null;
      }
      return prisma.sourceCandidate.upsert({
        where: { sourceKey: seed.sourceKey },
        update: {
          name: seed.name,
          sourceType: seed.sourceType,
          sourceUrl: seed.sourceUrl,
          fetchUrl: seed.fetchUrl,
          handle: seed.handle,
          avatarUrl: seed.avatarUrl,
          avatarDataUrl: seed.avatarDataUrl,
          seedBuilderId: seed.seedBuilderId,
          seededFrom: ADMIN_SOURCE_CANDIDATE_SEED,
        },
        create: seed,
      });
    }),
  );
}

async function seedCuratedAiSourceCandidates() {
  await Promise.all(
    CURATED_AI_SOURCE_CANDIDATES.map((candidate) => {
      const seed = seedFromCuratedCandidate(candidate);
      return prisma.sourceCandidate.upsert({
        where: { sourceKey: seed.sourceKey },
        update: {
          name: seed.name,
          sourceType: seed.sourceType,
          sourceUrl: seed.sourceUrl,
          fetchUrl: seed.fetchUrl,
          handle: seed.handle,
          avatarUrl: seed.avatarUrl,
          avatarDataUrl: null,
          seedBuilderId: null,
          seededFrom: CURATED_AI_SOURCE_CANDIDATE_SEED,
        },
        create: seed,
      });
    }),
  );
}

function seedFromBuilder(builder: BuilderSeedSource) {
  return {
    sourceKey: builder.canonicalKey,
    name: builder.name,
    sourceType: builder.sourceType,
    sourceUrl: builder.sourceUrl,
    fetchUrl: builder.fetchUrl,
    handle: builder.handle,
    avatarUrl: builder.avatarUrl,
    avatarDataUrl: builder.avatarDataUrl,
    seedBuilderId: builder.id,
    seededFrom: ADMIN_SOURCE_CANDIDATE_SEED,
  };
}

function seedFromCuratedCandidate(candidate: CuratedSourceCandidate) {
  return {
    sourceKey: sourceKeyForCuratedCandidate(candidate),
    name: candidate.name,
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
    fetchUrl: candidate.fetchUrl ?? null,
    handle: candidate.handle ?? null,
    avatarUrl: avatarUrlForCuratedCandidate(candidate),
    avatarDataUrl: null,
    seedBuilderId: null,
    seededFrom: CURATED_AI_SOURCE_CANDIDATE_SEED,
  };
}

function sourceKeyForCuratedCandidate(candidate: CuratedSourceCandidate) {
  const kind = builderKindForSourceType(candidate.sourceType);
  const value =
    candidate.sourceType === "x" && candidate.handle
      ? normalizeHandle(candidate.handle)
      : candidate.sourceUrl;
  return canonicalBuilderKey(kind, value);
}

function avatarUrlForCuratedCandidate(candidate: CuratedSourceCandidate) {
  if (candidate.avatarUrl) return candidate.avatarUrl;
  const domain = candidate.avatarDomain ?? sourceHost(candidate.sourceUrl);
  return domain ? googleFaviconUrl(domain) : null;
}

function sourceHost(sourceUrl: string) {
  try {
    return new URL(sourceUrl).host;
  } catch {
    return null;
  }
}

function googleFaviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function serializeSourceCandidate(candidate: {
  id: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  fetchUrl: string | null;
  handle: string | null;
  avatarUrl: string | null;
  avatarDataUrl: string | null;
}): SourceCandidate {
  return {
    id: candidate.id,
    name: candidate.name,
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
    fetchUrl: candidate.fetchUrl,
    handle: candidate.handle,
    avatarUrl: candidate.avatarUrl,
    avatarDataUrl: candidate.avatarDataUrl,
  };
}
