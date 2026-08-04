-- Keep source prompts focused on content semantics. Managed long-media tools
-- now run in the deterministic FollowBrief runner, outside model workers.

UPDATE "SourceTypeConfig"
SET "fetchPromptBody" = $$# Podcast Fetch Prompt

You are handling one podcast episode for FollowBrief. Decide what qualifies as
primary content using the episode title, episode URL, enclosure metadata, and
show notes extracted from the RSS `<item>`.

## Primary content

1. If show notes are substantial — ≥ 500 characters of body copy, with
   paragraph structure or speaker bullets, not just a one-line tagline,
   ad copy, or a list of social handles — use the show notes verbatim
   as the item body.
2. Otherwise, the FollowBrief runner prepares the episode transcript before a
   model worker starts. A model worker must use that runner-provided body and
   provenance exactly; machine tool choice is not controlled by this prompt.

## Output rules

- The item URL must be the specific episode page (RSS `<link>` or the
  podcast platform's per-episode URL). Never link to the channel page.
- Do not invent a transcript when none is supplied; report the task with a
  clear reason instead.
- Do not summarize at this stage — that happens in a later step. Send
  the full transcript (or full show-notes block) as the body.$$
WHERE "sourceId" = 'podcast'
  AND "fetchPromptBody" LIKE '%fall back to audio:%'
  AND "fetchPromptBody" LIKE '%Run OpenAI Whisper%';

WITH prompt(body) AS (VALUES ($$# Podcast Fetch Prompt

You are handling one podcast episode for FollowBrief. Decide what qualifies as
primary content using the episode title, episode URL, enclosure metadata, and
show notes extracted from the RSS `<item>`.

## Primary content

1. If show notes are substantial — ≥ 500 characters of body copy, with
   paragraph structure or speaker bullets, not just a one-line tagline,
   ad copy, or a list of social handles — use the show notes verbatim
   as the item body.
2. Otherwise, the FollowBrief runner prepares the episode transcript before a
   model worker starts. A model worker must use that runner-provided body and
   provenance exactly; machine tool choice is not controlled by this prompt.

## Output rules

- The item URL must be the specific episode page (RSS `<link>` or the
  podcast platform's per-episode URL). Never link to the channel page.
- Do not invent a transcript when none is supplied; report the task with a
  clear reason instead.
- Do not summarize at this stage — that happens in a later step. Send
  the full transcript (or full show-notes block) as the body.$$))
UPDATE "UserSourceTypeConfig"
SET "fetchPromptBody" = prompt.body
FROM prompt
WHERE "sourceId" = 'podcast'
  AND "fetchPromptBody" LIKE '%fall back to audio:%'
  AND "fetchPromptBody" LIKE '%Run OpenAI Whisper%';

UPDATE "SourceTypeConfig"
SET "fetchPromptBody" = $$# YouTube Fetch Prompt

You are fetching one YouTube video for FollowBrief. Apply these rules to
this video only; never infer one video's content from another video.

Primary content is the video's transcript. FollowBrief resolves it before
model summarization:

1. Prefer creator/manual captions over auto captions. If multiple languages
   are present, use only strong evidence to choose the original spoken language:
   caption/translation metadata, dominant language in the video/channel
   metadata, or a small sample of candidate captions. Do not default to
   English just because it is available. If source language remains unclear,
   report the task as blocked/failed with the available caption languages.
2. If captions are unavailable, the FollowBrief runner prepares local speech
   transcription before a model worker starts. A model worker must not choose
   or launch machine transcription tools.

Never use video frames, screenshots, thumbnails, OCR, the title, or the
description as primary content.

Output the full transcript as the item body and preserve the runner-provided
rawJson.transcriptSource, such as "youtube-captions" or
"local-speech-to-text". If no transcript can be produced, fail or skip the task
with concrete per-video evidence. Do not summarize at this stage.$$
WHERE "sourceId" = 'youtube'
  AND (
    "fetchPromptBody" LIKE '%Prefer faster-whisper or MLX Whisper%'
    OR "fetchPromptBody" LIKE '%fall back to the local whisper CLI%'
  );

WITH prompt(body) AS (VALUES ($$# YouTube Fetch Prompt

You are fetching one YouTube video for FollowBrief. Apply these rules to
this video only; never infer one video's content from another video.

Primary content is the video's transcript. FollowBrief resolves it before
model summarization:

1. Prefer creator/manual captions over auto captions. If multiple languages
   are present, use only strong evidence to choose the original spoken language:
   caption/translation metadata, dominant language in the video/channel
   metadata, or a small sample of candidate captions. Do not default to
   English just because it is available. If source language remains unclear,
   report the task as blocked/failed with the available caption languages.
2. If captions are unavailable, the FollowBrief runner prepares local speech
   transcription before a model worker starts. A model worker must not choose
   or launch machine transcription tools.

Never use video frames, screenshots, thumbnails, OCR, the title, or the
description as primary content.

Output the full transcript as the item body and preserve the runner-provided
rawJson.transcriptSource, such as "youtube-captions" or
"local-speech-to-text". If no transcript can be produced, fail or skip the task
with concrete per-video evidence. Do not summarize at this stage.$$))
UPDATE "UserSourceTypeConfig"
SET "fetchPromptBody" = prompt.body
FROM prompt
WHERE "sourceId" = 'youtube'
  AND (
    "fetchPromptBody" LIKE '%Prefer faster-whisper or MLX Whisper%'
    OR "fetchPromptBody" LIKE '%fall back to the local whisper CLI%'
  );

UPDATE "DigestConfig"
SET "commonFetchRules" = replace(
  "commonFetchRules",
  'Use `task.item.url`, `task.sourceType`, and `task.agentWorkType` to pick any extraction method available: web fetch, local CLI tools (yt-dlp, curl, ffmpeg, headless browser, etc.), transcription APIs - anything you have.',
  E'Use `task.item.url`, `task.sourceType`, and `task.agentWorkType` to obtain primary page or API content with the methods available to the model worker.\nManaged YouTube and podcast speech transcription is prepared by the FollowBrief runner before model work. Never launch or replace that machine-level media pipeline from a source prompt.'
)
WHERE "commonFetchRules" LIKE '%local CLI tools (yt-dlp, curl, ffmpeg%'
  AND "commonFetchRules" LIKE '%transcription APIs - anything you have%';

UPDATE "UserDigestConfig"
SET "commonFetchRules" = replace(
  "commonFetchRules",
  'Use `task.item.url`, `task.sourceType`, and `task.agentWorkType` to pick any extraction method available: web fetch, local CLI tools (yt-dlp, curl, ffmpeg, headless browser, etc.), transcription APIs - anything you have.',
  E'Use `task.item.url`, `task.sourceType`, and `task.agentWorkType` to obtain primary page or API content with the methods available to the model worker.\nManaged YouTube and podcast speech transcription is prepared by the FollowBrief runner before model work. Never launch or replace that machine-level media pipeline from a source prompt.'
)
WHERE "commonFetchRules" LIKE '%local CLI tools (yt-dlp, curl, ffmpeg%'
  AND "commonFetchRules" LIKE '%transcription APIs - anything you have%';
