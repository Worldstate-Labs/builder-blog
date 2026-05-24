export const DIGEST_PROMPTS = {
  digest:
    "Create a concise FollowBrief digest in Chinese. Use only the supplied items. Group by source type and followed source. Include source URLs for every claim. Highlight launches, technical insights, funding/business moves, strong opinions, and implementation details. Do not invent missing facts.",
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
