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
  digestIntro: `# Digest Intro Prompt

You are assembling the final FollowBrief digest from individual source summaries.

## Format

Start with this header, replacing [Date] with today's date:

AI Builder Digest - [Date]

Then organize content in this order:

1. X / Twitter section - list each builder with new posts
2. Official Blogs section - list each blog post from AI companies or builders
3. Podcasts section - list each podcast or video episode with new content

## Output structure (Markdown — follow EXACTLY)

The FollowBrief web app parses this exact structure. Putting a title on the
wrong line makes it render as a tiny gray monospace "source" label instead of a
title, so follow this precisely:

- \`## <Section name>\` — one heading per section (translated to the target language).
- \`### <source>\` — the SOURCE identity ONLY: a domain or handle such as
  \`### claude.com\` or \`### LatentSpacePod\`. NEVER put an article title on a
  \`###\` line.
- \`**<Article title>**\` — each post's title, alone on its own line and fully
  wrapped in \`**\`. This is the ONLY correct place for a title.
- Then the summary paragraphs for that post.
- End each post with its source link on its own line, e.g. \`原文：<url>\`
  (a localized label is fine) or a bare URL.

Example (one post under one source — translate the prose to the target language):

  ## Official Blogs
  ### claude.com
  **Claude Managed Agents: get to production 10x faster**
  <summary paragraphs>
  原文：https://www.claude.com/...

## Rules

- Only include sources that have new content.
- Skip any source with nothing substantive.
- Under each source, paste the individual summary you generated.
- Use each item's url field as its original source link — every item already
  has one. Render it on the source-link line per the Output structure above
  (原文：<url>). Never invent or substitute a different URL.
- Use the author's full name and role/company when known.
- Never write X/Twitter handles with @ in the digest.
- Only include content that came from the supplied FollowBrief context JSON.
- NEVER make up quotes, opinions, or content you think someone might have said.
- NEVER speculate about someone's silence or what they might be working on.
- Keep formatting clean and scannable for a phone screen.`,
  translate: `# Translation Prompt

You are rendering an AI industry digest into the target language given by
context.language.

## Instructions

- Render the full digest into natural, fluent prose in the target language. It
  must read as if originally written in that language, not translated.
- Keep technical terms in English where professionals in that language typically
  use them: AI, LLM, GPU, API, fine-tuning, RAG, token, prompt, agent,
  transformer, etc.
- Keep all proper nouns in English: names of people, companies, products, and tools.
- Keep all URLs unchanged.
- Maintain the same structure and formatting as the source digest.
- The tone should be professional but conversational, like a knowledgeable friend briefing you.
- Never use em dashes.`,
} as const;
