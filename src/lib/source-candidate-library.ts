import { canonicalBuilderKey, normalizeHandle } from "@/lib/builder-keys";
import { prisma } from "@/lib/prisma";
import type { SourceCandidate } from "@/lib/source-candidates";
import { builderKindForSourceType } from "@/lib/source-registry";

const ADMIN_SOURCE_CANDIDATE_SEED = "admin_source_library";
const CURATED_AI_SOURCE_CANDIDATE_SEED = "curated_ai_sources";
const SOURCE_CANDIDATE_LIMIT = 300;

type CuratedSourceCandidate = {
  name: string;
  sourceType: string;
  sourceUrl: string;
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
  { name: "arXiv AI Papers", sourceType: "blog", sourceUrl: "https://rss.arxiv.org/rss/cs.AI", fetchUrl: "https://rss.arxiv.org/rss/cs.AI" },
  { name: "arXiv NLP Papers", sourceType: "blog", sourceUrl: "https://rss.arxiv.org/rss/cs.CL", fetchUrl: "https://rss.arxiv.org/rss/cs.CL" },
  { name: "arXiv Machine Learning Papers", sourceType: "blog", sourceUrl: "https://rss.arxiv.org/rss/cs.LG", fetchUrl: "https://rss.arxiv.org/rss/cs.LG" },
  { name: "The Gradient", sourceType: "blog", sourceUrl: "https://thegradient.pub/rss/", fetchUrl: "https://thegradient.pub/rss/" },
  { name: "Lil'Log by Lilian Weng", sourceType: "blog", sourceUrl: "https://lilianweng.github.io/lil-log/feed.xml", fetchUrl: "https://lilianweng.github.io/lil-log/feed.xml" },
  { name: "Ahead of AI", sourceType: "blog", sourceUrl: "https://magazine.sebastianraschka.com/feed", fetchUrl: "https://magazine.sebastianraschka.com/feed" },
  { name: "Latent Space", sourceType: "blog", sourceUrl: "https://www.latent.space/feed", fetchUrl: "https://www.latent.space/feed" },
  { name: "The Batch by DeepLearning.AI", sourceType: "blog", sourceUrl: "https://www.deeplearning.ai/the-batch/" },
  { name: "Interconnects", sourceType: "blog", sourceUrl: "https://www.interconnects.ai/feed", fetchUrl: "https://www.interconnects.ai/feed" },
  { name: "Simon Willison's Weblog", sourceType: "blog", sourceUrl: "https://simonwillison.net/atom/everything/", fetchUrl: "https://simonwillison.net/atom/everything/" },
  { name: "No Priors", sourceType: "podcast", sourceUrl: "https://feeds.megaphone.fm/nopriors", fetchUrl: "https://feeds.megaphone.fm/nopriors" },
  { name: "Practical AI Podcast", sourceType: "podcast", sourceUrl: "https://feeds.transistor.fm/practical-ai-machine-learning-data-science-llm", fetchUrl: "https://feeds.transistor.fm/practical-ai-machine-learning-data-science-llm" },
  { name: "Latent Space Podcast", sourceType: "podcast", sourceUrl: "https://api.substack.com/feed/podcast/1084089.rss", fetchUrl: "https://api.substack.com/feed/podcast/1084089.rss" },
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
  { name: "AI Engineering Podcast", sourceType: "podcast", sourceUrl: "https://serve.podhome.fm/rss/c9abdd38-a5dc-5eb2-96fd-f833f93208a7", fetchUrl: "https://serve.podhome.fm/rss/c9abdd38-a5dc-5eb2-96fd-f833f93208a7" },
  { name: "OpenAI YouTube", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@OpenAI" },
  { name: "Google DeepMind YouTube", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@GoogleDeepMind" },
  { name: "Andrej Karpathy YouTube", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@AndrejKarpathy" },
  { name: "Yannic Kilcher", sourceType: "youtube", sourceUrl: "https://www.youtube.com/c/YannicKilcher" },
  { name: "Two Minute Papers", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@TwoMinutePapers" },
  { name: "AI Explained", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@aiexplained-official" },
  { name: "DeepLearning.AI YouTube", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@Deeplearningai" },
  { name: "Machine Learning Street Talk", sourceType: "youtube", sourceUrl: "https://www.youtube.com/c/machinelearningstreettalk" },
  { name: "Computerphile", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@Computerphile" },
  { name: "IBM Technology", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@IBMTechnology" },
  { name: "3Blue1Brown", sourceType: "youtube", sourceUrl: "https://www.youtube.com/@3blue1brown" },
  { name: "Andrej Karpathy on X", sourceType: "x", sourceUrl: "https://x.com/karpathy", handle: "karpathy" },
  { name: "Google Labs on X", sourceType: "x", sourceUrl: "https://x.com/googlelabs", handle: "googlelabs" },
  { name: "OpenAI on X", sourceType: "x", sourceUrl: "https://x.com/OpenAI", handle: "OpenAI" },
  { name: "Anthropic on X", sourceType: "x", sourceUrl: "https://x.com/AnthropicAI", handle: "AnthropicAI" },
  { name: "Google DeepMind on X", sourceType: "x", sourceUrl: "https://x.com/GoogleDeepMind", handle: "GoogleDeepMind" },
  { name: "Meta AI on X", sourceType: "x", sourceUrl: "https://x.com/AIatMeta", handle: "AIatMeta" },
  { name: "Hugging Face on X", sourceType: "x", sourceUrl: "https://x.com/huggingface", handle: "huggingface" },
  { name: "Andrew Ng on X", sourceType: "x", sourceUrl: "https://x.com/AndrewYNg", handle: "AndrewYNg" },
  { name: "Ethan Mollick on X", sourceType: "x", sourceUrl: "https://x.com/emollick", handle: "emollick" },
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
  await seedSourceCandidatesFromAdminLibrary();
  await seedCuratedAiSourceCandidates();
  return listSourceCandidates();
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
          avatarUrl: null,
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
    avatarUrl: null,
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
