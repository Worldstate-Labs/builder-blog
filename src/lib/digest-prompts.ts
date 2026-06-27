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
   - Download the audio enclosure to a temp file under the current job temp
     directory when one is available.
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
  fetchYouTubeTranscript: `# YouTube Fetch Prompt

You are fetching one YouTube video for FollowBrief. Apply these rules to
this video only; never infer one video's content from another video.

Primary content is the video's transcript. Use the fastest reliable local
method available before doing heavier transcription:

1. Try captions first. Prefer creator/manual captions over auto captions.
   Use yt-dlp metadata/subtitle output, YouTube caption tracks, or
   youtube-transcript-api if available. If multiple languages are present,
   use only strong evidence to choose the original spoken language:
   caption/translation metadata, dominant language in the video/channel
   metadata, or a small sample of candidate captions. Do not default to
   English just because it is available. If source language remains unclear,
   report the task as blocked/failed with the available caption languages.
2. Only if no usable captions/transcript are available, use local speech
   transcription. Prefer faster-whisper or MLX Whisper when installed; fall
   back to the local whisper CLI if that is the only ASR backend available.
   Do not use the OpenAI API for this task.

Never use video frames, screenshots, thumbnails, OCR, the title, or the
description as primary content.

Output the full transcript as the item body and set rawJson.transcriptSource
to the actual source, such as "youtube-captions", "local-speech-to-text", or
"agent-transcript". If no transcript can be produced, fail or skip the task
with concrete per-video evidence. Do not summarize at this stage.`,
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
  fetchGithubTrendingRepo: `# GitHub Trending Repo Fetch Prompt

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
  summarizeGithubTrendingRepo: `# GitHub Trending Repo Summary Prompt

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

You are extracting exactly one Product Hunt top-products task for FollowBrief.
Use agent judgment to handle Product Hunt's changing page structure, but keep
the scope bounded: this is structured extraction, not open-ended product
research.

## Required workflow

1. Open \`task.item.url\`, the Product Hunt product page. Extract only visible
   Product Hunt facts: product name, tagline, launch/rank badge, maker notes,
   website link, tags, vote/comment counts, comments, and launch date when
   visible.
2. If Product Hunt exposes an official website link, open that website and at
   most one directly linked product page such as docs, pricing, about, or
   homepage content that explains the workflow. Do not browse beyond this
   official-site path.
3. Explain what the product concretely does from Product Hunt plus the official
   site only. Identify target user, workflow, and outcome when visible.
4. Explain why it is noteworthy using only visible evidence: Product Hunt rank,
   tagline, maker notes, visible comments/counts, official-site capabilities,
   and the known top-products context from task metadata. Mark any reasonable
   inference explicitly as inference.
5. If a field is hidden, login-gated, blocked, or not visible, write "not
   visible" instead of searching elsewhere.

## Body to return

Return a structured body, not a summary-only stub, using these fields:

Product name:
Rank/date:
Product Hunt URL:
Official website URL:
Product Hunt tagline:
Visible Product Hunt evidence:
Official-site evidence:
What the product does:
Target user:
Workflow:
Why it is noteworthy:
Not visible:
Sources:

Rules:

- Preserve source URLs for every material claim.
- Use "not visible" for hidden Product Hunt comments, counts, makers, pricing,
  docs, or website details.
- Do not invent comment sentiment, numbers, quotes, customers, benchmarks,
  affiliations, pricing, or launch traction.
- Do not include claims from general web search or third-party pages.`,
  summarizeProductHuntTopProduct: `# Product Hunt Top Product Summary Prompt

You are summarizing one Product Hunt top-product investigation for a busy
professional. Use only task.item.body plus task.item metadata.

Use the user-selected output language supplied by the enclosing task. Do not
hard-code any fixed language.

Write a mobile-friendly digest card summary, not a label/value template.

Use two short paragraphs:

1. Start with the product name naturally in the first sentence, then explain
   what the product does, the workflow, and the target user.
2. Explain why it is notable using rank, Product Hunt evidence, official-site
   evidence, or clearly marked inference. Preserve the Product Hunt URL and any
   important supporting URLs inline when they matter.

Rules:

- Keep it concise but concrete.
- Mention rank when the body or metadata provides it.
- Do not output field labels such as "Product name:", "What the product does:",
  "Why it is excellent:", "Product Hunt URL:", or "Date:".
- Do not put a field label on its own line or add blank spacer lines between a
  label and its value.
- Separate confirmed Product Hunt comments or web evidence from reasonable
  inference. Do not overstate weak evidence.
- Preserve the Product Hunt URL and any important supporting URLs from the body.`,
  // Legacy field retained only for old database rows / old local clients. New
  // digest runs do not ask the agent to assemble markdown with this prompt.
  digestIntro: `# Legacy Digest Intro Prompt

FollowBrief now assembles the digest body programmatically. This legacy prompt is not used by current digest jobs.`,
  headline: `# Digest Headline Prompt

Write only \`headlineSummary\` for the candidate posts in the supplied FollowBrief context.

Use \`context.language\`. If \`context.language\` is \`source\`, write in the dominant language of the supplied candidate post summaries.

Write compact headline lines covering all candidate sources. Prefer one line per
source, but if the headline would exceed the hard length limit, combine related
or lower-priority sources into one line. Use this exact line format:

- Source name: one sentence summary
- Source A and Source B: one sentence summary

Rules:

- Cover every source that has candidate posts. A source may be covered by a
  combined line such as \`GitHub Trending and Product Hunt Top Products: ...\`.
- Use the same source order as the digest: follow \`context.digest.order\` when provided; otherwise use Podcast / Audio Feed, YouTube, Blog / Article Feed, X/Twitter, GitHub Trending, Product Hunt Top Products, then Website. Within each source type, order sources by source name.
- Keep each source summary to 50 characters or fewer for Chinese/Japanese/Korean output, or 50 words or fewer for word-delimited languages.
- Keep the entire \`headlineSummary\` at 1200 characters or fewer. Before writing
  the JSON, count or conservatively estimate the final string length and
  shorten or merge lines until it fits. Prefer 900 characters or fewer when
  there are many sources.
- Summarize all candidate posts from that source together instead of listing each post.
- Use only facts already present in the candidate post summaries and metadata.
- Do not include raw URLs.`,
  perSourceSummary: `# Per-Source Summary Prompt

You are writing an optional source-level summary for exactly one source in a FollowBrief digest.

Use \`context.language\`. If \`context.language\` is \`source\`, write in the dominant language of this source group's supplied post summaries. The input contains one source and that source's candidate posts only. Write a short source-level summary only when this source has multiple candidate posts and those posts are meaningfully about the same actor, source, or main subject. If the posts are unrelated, too sparse, or there is only one candidate post, output an empty string.

Do not summarize every post again. Do not add facts beyond the supplied post summaries and metadata.`,
} as const;
