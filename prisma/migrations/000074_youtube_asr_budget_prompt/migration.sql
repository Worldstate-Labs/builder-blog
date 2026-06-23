-- Keep YouTube local transcription bounded: captions first, then local ASR only
-- when the video's duration fits the worker budget. This prevents long videos
-- from consuming the full shard timeout without a usable transcript.
UPDATE "SourceTypeConfig"
SET "fetchPromptBody" = $$# YouTube Fetch Prompt

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
   transcription. Before starting local speech transcription, estimate this
   video's duration (for example from yt-dlp metadata or ffprobe) and compare it
   with the available worker budget. If full local ASR is unlikely to complete
   inside the worker budget, do not start a long transcription run; report this
   task as failed with reason "local_asr_duration_exceeded" and
   evidence including durationSeconds, attempted caption methods, and the
   available local ASR backend. Prefer faster-whisper or MLX Whisper when
   installed; fall back to the local whisper CLI if that is the only ASR backend
   available. Do not use the OpenAI API for this task.

Never use video frames, screenshots, thumbnails, OCR, the title, or the
description as primary content.

Output the full transcript as the item body and set rawJson.transcriptSource
to the actual source, such as "youtube-captions", "local-speech-to-text", or
"agent-transcript". If no transcript can be produced, fail or skip the task
with concrete per-video evidence. Do not summarize at this stage.$$
WHERE "sourceId" = 'youtube'
  AND (
    "fetchPromptBody" IS NULL
    OR "fetchPromptBody" LIKE '# YouTube Fetch Prompt%'
    OR "fetchPromptBody" LIKE 'YouTube extraction%'
  );

UPDATE "UserSourceTypeConfig"
SET "fetchPromptBody" = $$# YouTube Fetch Prompt

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
   transcription. Before starting local speech transcription, estimate this
   video's duration (for example from yt-dlp metadata or ffprobe) and compare it
   with the available worker budget. If full local ASR is unlikely to complete
   inside the worker budget, do not start a long transcription run; report this
   task as failed with reason "local_asr_duration_exceeded" and
   evidence including durationSeconds, attempted caption methods, and the
   available local ASR backend. Prefer faster-whisper or MLX Whisper when
   installed; fall back to the local whisper CLI if that is the only ASR backend
   available. Do not use the OpenAI API for this task.

Never use video frames, screenshots, thumbnails, OCR, the title, or the
description as primary content.

Output the full transcript as the item body and set rawJson.transcriptSource
to the actual source, such as "youtube-captions", "local-speech-to-text", or
"agent-transcript". If no transcript can be produced, fail or skip the task
with concrete per-video evidence. Do not summarize at this stage.$$
WHERE "sourceId" = 'youtube'
  AND (
    "fetchPromptBody" IS NULL
    OR "fetchPromptBody" LIKE '# YouTube Fetch Prompt%'
    OR "fetchPromptBody" LIKE 'YouTube extraction%'
  );
