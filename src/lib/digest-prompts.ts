// Seed-only defaults for the DigestConfig + per-source SourceTypeConfig
// rows. The runtime source of truth for these prompts is the database
// (see `src/lib/source-config-store.ts`); admins hot-edit them from the
// admin UI. Nothing in the request/response path should import this file
// — only the seeder (`ensureSourceConfigsSeeded` / `prisma/seed.ts`)
// should read these strings.
export const DEFAULT_DIGEST_PROMPTS = {
  summarizeTweets: `# X/Twitter Summary Prompt

You are summarizing recent posts from an AI builder for a busy professional who wants
to know what this person is thinking and building.

## Instructions

- Start by introducing the author with their full name AND role/company when known.
  Do NOT use just their last name. Do NOT use their X/Twitter handle with @.
- Only include substantive content: original opinions, insights, product announcements,
  technical discussions, industry analysis, or lessons learned.
- SKIP: mundane personal posts, retweets without commentary, weak promotional content,
  "great event!" type posts, and engagement bait.
- For threads: summarize the full thread as one cohesive piece, not individual posts.
- For quote tweets: include the context of what they are responding to when it is present
  in the supplied item body.
- Write 2-4 sentences per builder summarizing their key points.
- If they made a bold prediction or shared a contrarian take, lead with that.
- If they shared a tool, demo, launch, or resource, mention it by name with the direct URL.
- If there is nothing substantive to report, skip that builder instead of padding with fluff.`,
  summarizePodcast: `# Podcast Remix Prompt

You are remixing a podcast transcript or podcast episode transcript for a busy professional who wants
the key insights without watching the full episode.

## Instructions

- Write a remix of 200-400 words.
- Start with a one-sentence "The Takeaway" that captures the most important point.
- Introduce the speaker context from the supplied metadata or transcript when available.
- Prioritize insights that are counterintuitive, contrarian, or refreshingly specific to
  the speaker's experience. Avoid generic wisdom.
- Include at least one direct quote only when the quote appears in the supplied transcript.
- Stand alone as a complete piece. Avoid filler like "this interview", "this video",
  "in this conversation", "the host asks", or "in this episode".
- If the source contains specialized knowledge, translate it into language a curious
  non-specialist can understand.
- Keep the tone sharp and conversational, like a smart friend briefing you.
- Include the specific episode or video URL from the supplied item. Never link to a
  channel page when an episode URL is available.`,
  fetchPodcastAudio: `# Podcast Fetch Prompt

You are fetching one podcast episode for FollowBrief. Decide which
content to send back as the item body using the inputs supplied with
the task (episode title, episode URL, audio enclosure URL, and the show
notes text extracted from the RSS \`<item>\`).

## Decision

1. If show notes are substantial — ≥ 500 characters of body copy, with
   paragraph structure or speaker bullets, not just a one-line tagline,
   ad copy, or a list of social handles — use the show notes verbatim
   as the item body.
2. Otherwise, fall back to audio:
   - Download the audio enclosure to a temp file on the local machine.
   - Run OpenAI Whisper (or another local ASR you have configured) on
     the audio to produce a full transcript.
   - Use the transcript as the item body. Mark \`rawJson.transcriptSource\`
     as \`openai-audio-transcription\` (or the equivalent string for your
     ASR) so the server's content-quality checks accept it.
   - After the transcript is uploaded, DELETE the audio file and the
     raw transcript from the temp dir. Do not persist either to disk
     beyond the current task.

## Output rules

- The item URL must be the specific episode page (RSS \`<link>\` or the
  podcast platform's per-episode URL). Never link to the channel page.
- Do not invent a transcript when none can be produced; fail the task
  with a clear reason instead.
- Do not summarize at this stage — that happens in a later step. Send
  the full transcript (or full show-notes block) as the body.`,
  summarizeBlogs: `# Blog Post Summary Prompt

You are summarizing a blog post from an AI company or builder for a busy
professional who wants the key announcements and insights without reading the full article.

## Instructions

- Start with the source name and article title.
- Write a summary of 100-300 words depending on article length and substance.
- Lead with what matters: the core announcement, finding, or insight.
- If the post introduces a new product, feature, or research finding, name it clearly.
- If there are specific numbers, benchmarks, or results, include them.
- Include a direct quote only when it appears in the supplied article body.
- If the post has practical implications, such as a new API, capability, policy change,
  architecture decision, or migration path, call them out explicitly.
- Keep the tone sharp and informative, like a smart colleague forwarding you the key points.
- Do NOT include filler like "In this blog post..." or "The author discusses..."
- Jump straight into the substance.
- Include the direct link to the original article.`,
  fetchGithubTrendingRepo: `# Github Trending Repo Fetch Prompt

You are fetching exactly one GitHub Trending repository task for FollowBrief.
The task item was created from https://github.com/trending?since=daily, and
\`task.item.url\` is the repository URL to investigate.

## Required workflow

1. Read the repository README from the default branch. If GitHub blocks the
   HTML page, use the GitHub REST API or raw README URL. A GitHub token is
   optional; do not require one.
2. Inspect repository evidence beyond the README: description, topics,
   language, file tree, package/config files, examples, releases, and recent
   commits when available.
3. Use web search to understand why this repo is gaining stars today. Search
   the repo name plus terms like launch, release, announcement, Hacker News,
   Reddit, Product Hunt, X/Twitter, blog, and GitHub Trending.
4. Distinguish evidence from inference. If you cannot find an external cause,
   say that the likely cause is inferred from GitHub Trending visibility and
   repo/release activity rather than a confirmed announcement.

## Body to return

Return a substantial body, not a summary-only stub. It must include:

- Project name and repository URL.
- Today's date from task.item.rawJson.date when present.
- Stars today from task.item.rawJson.starsToday when present.
- What the project concretely does, based on README and repo contents.
- Repo-content evidence: notable files/directories, stack/language, examples,
  releases, or recent commits.
- Why it appears to be rising quickly today, with source URLs and clear labels
  for confirmed evidence vs inference.

Do not summarize from the GitHub Trending row alone. Do not invent causes,
numbers, quotes, benchmarks, or affiliations. Include source URLs for every
material claim so the later summary can cite the repo and supporting pages.`,
  summarizeGithubTrendingRepo: `# Github Trending Repo Summary Prompt

You are summarizing one GitHub Trending repository investigation for a busy
professional. Use only task.item.body plus task.item metadata.

Use the user-selected output language supplied by the enclosing task. Do not
hard-code any fixed language.

Use this structure, translating the section labels naturally when the selected
language is not English:

Project name:
What the project does:
Why it is gaining stars quickly:
Project URL:
Date:

Rules:

- Keep it concise but concrete.
- Mention stars today when the body or metadata provides it.
- In "What the project does", explain the actual product/library/agent/tool and who would use it.
- In "Why it is gaining stars quickly", separate confirmed causes from reasonable inference. Do not overstate weak evidence.
- Preserve the repository URL and any important supporting URLs from the body.`,
  fetchProductHuntTopProduct: `# Product Hunt Top Product Fetch Prompt

You are fetching exactly one Product Hunt top-products task for FollowBrief.
The task item was created from https://www.producthunt.com/, and
\`task.item.url\` is the Product Hunt product page to investigate.

## Required workflow

1. Open the Product Hunt product page. Extract the product name, tagline,
   launch date/rank badge, maker notes, website link, tags, vote/comment counts
   when visible, and substantive user comments.
2. Use the product's official website and web search when Product Hunt comments
   are thin or login-gated. Search the product name plus terms like launch,
   review, demo, pricing, documentation, blog, X/Twitter, Hacker News, Reddit,
   and Product Hunt.
3. Explain what the product concretely does. Do not stop at the Product Hunt
   tagline; identify the user workflow, target user, and outcome.
4. Explain why the product appears strong today using evidence: comment
   sentiment, maker explanations, launch traction, differentiated workflow,
   credible external coverage, or specific product capabilities.
5. Distinguish evidence from inference. If no useful comments or external
   sources are available, say the assessment is based on the Product Hunt page
   and product website rather than confirmed community discussion.

## Body to return

Return a substantial body, not a summary-only stub. It must include:

- Product name and Product Hunt URL.
- Today's date from task.item.rawJson.date when present.
- Rank from task.item.rawJson.rank when present.
- Product Hunt tagline/description when available.
- What the product concretely does, based on Product Hunt plus the website or docs.
- Why it appears excellent or noteworthy today, with source URLs and clear labels
  for confirmed evidence vs inference.
- Product website URL when available.

Do not invent comment sentiment, numbers, quotes, customers, benchmarks, or
affiliations. Include source URLs for every material claim so the later summary
can cite Product Hunt and supporting pages.`,
  summarizeProductHuntTopProduct: `# Product Hunt Top Product Summary Prompt

You are summarizing one Product Hunt top-product investigation for a busy
professional. Use only task.item.body plus task.item metadata.

Use the user-selected output language supplied by the enclosing task. Do not
hard-code any fixed language.

Use this structure, translating the section labels naturally when the selected
language is not English:

Product name:
What the product does:
Why it is excellent:
Product Hunt URL:
Date:

Rules:

- Keep it concise but concrete.
- Mention rank when the body or metadata provides it.
- In "What the product does", explain the actual workflow and target user.
- In "Why it is excellent", separate confirmed Product Hunt comments or web
  evidence from reasonable inference. Do not overstate weak evidence.
- Preserve the Product Hunt URL and any important supporting URLs from the body.`,
  // Legacy field retained only for old database rows / old local clients. New
  // digest runs do not ask the agent to assemble markdown with this prompt.
  digestIntro: `# Legacy Digest Intro Prompt

FollowBrief now assembles the digest body programmatically. This legacy prompt is not used by current digest jobs.`,
  headline: `# Digest Headline Prompt

Write only \`headlineSummary\` for the candidate posts in the supplied FollowBrief context.

Use \`context.language\`. If \`context.language\` is \`source\`, write in the dominant language of the supplied candidate post summaries. Keep it compact: one short news-headline paragraph in the selected language, suitable for a mobile digest header. Keep it to 300 characters or fewer. Do not include raw URLs. Use only facts already present in the candidate post summaries and metadata.`,
  perSourceSummary: `# Per-Source Summary Prompt

You are writing an optional source-level summary for exactly one source in a FollowBrief digest.

Use \`context.language\`. If \`context.language\` is \`source\`, write in the dominant language of this source group's supplied post summaries. The input contains one source and that source's candidate posts only. Write a short source-level summary only when this source has multiple candidate posts and those posts are meaningfully about the same actor, source, or main subject. If the posts are unrelated, too sparse, or there is only one candidate post, output an empty string.

Do not summarize every post again. Do not add facts beyond the supplied post summaries and metadata.`,
  translate: `# Translation Prompt

You are rewriting, translating, and compressing an already-written per-post
summary into the target language given by context.language. If context.language
is source, keep each per-post summary in the same language as the supplied
summary instead of translating it to a fixed language.

## Instructions

- Render only the supplied per-post summary into natural, fluent prose in
  context.language. If context.language is source, use the supplied summary's
  own language. It must read as if originally written in that language, not
  translated.
- Keep the output to no more than 300 Chinese characters when context.language
  is Chinese. For word-delimited languages, keep it to 300 words or fewer.
  Preserve the original per-post summary's important points, concrete facts,
  names, numbers, URLs, and source attribution.
- Compress wording, not meaning. Do not drop a key claim just to make the copy
  shorter unless it is repetitive or low-signal.
- Do not write headlineSummary.
- Do not write source-level summaries.
- Do not change digest structure or add section headings.
- Keep technical terms in English where professionals in that language typically
  use them: AI, LLM, GPU, API, fine-tuning, RAG, token, prompt, agent,
  transformer, etc.
- Keep all proper nouns in English: names of people, companies, products, and tools.
- Keep all URLs unchanged.
- The tone should be professional but conversational, like a knowledgeable friend briefing you.
- Never use em dashes.`,
} as const;
