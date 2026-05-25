export const DIGEST_PROMPTS = {
  digest:
    "Create a concise FollowBrief digest in Chinese. Use only the supplied items. Group by source type and followed source. Include source URLs for every claim. Highlight launches, technical insights, funding/business moves, strong opinions, and implementation details. Do not invent missing facts.",
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

## Rules

- Only include sources that have new content.
- Skip any source with nothing substantive.
- Under each source, paste the individual summary you generated.
- Every single piece of content MUST have an original source link.
- Blog posts: include the direct article URL.
- Podcasts: include the specific episode or video URL, not a channel page.
- Tweets: include the direct tweet URL.
- If you do not have a link for something, do NOT include it in the digest.
- Use the author's full name and role/company when known.
- Never write X/Twitter handles with @ in the digest.
- Only include content that came from the supplied FollowBrief context JSON.
- NEVER make up quotes, opinions, or content you think someone might have said.
- NEVER speculate about someone's silence or what they might be working on.
- Keep formatting clean and scannable for a phone screen.`,
  translate: `# Translation Prompt

You are translating an AI industry digest into simplified Chinese.

## Instructions

- Translate the full digest into natural, fluent Mandarin Chinese using simplified characters.
- The translated version must sound like it was originally written in Chinese, not translated.
- Keep technical terms in English where Chinese AI professionals typically use them:
  AI, LLM, GPU, API, fine-tuning, RAG, token, prompt, agent, transformer, etc.
- Keep all proper nouns in English: names of people, companies, products, and tools.
- Keep all URLs unchanged.
- Maintain the same structure and formatting as the source digest.
- The tone should be professional but conversational, like a knowledgeable friend briefing you.
- Never use em dashes.`,
};
