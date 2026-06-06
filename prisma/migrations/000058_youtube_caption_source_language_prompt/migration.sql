-- Clarify YouTube fallback extraction so agents choose source-language
-- captions instead of defaulting to English when several subtitle tracks exist.
-- Restrict to the current template so admin/user edits are not overwritten.
UPDATE "SourceTypeConfig"
SET "fetchPromptBody" = $$YouTube extraction — apply to EACH video on its own. Never infer one video's
content from another, and never skip a batch of videos based on a single
video's result. Run the checks below per video.

Primary content is the video's TRANSCRIPT. Acquire it in this order:
1. Captions first — official/creator captions or auto-captions (e.g. yt-dlp
   --write-auto-subs / --write-subs, or a transcript API).
   If multiple caption languages are available, choose the transcript in the
   video's original spoken language. Do not default to English just because it
   is available, listed first, or easier to download. Use only strong evidence:
   YouTube caption/translation metadata, the dominant language of the
   video/channel metadata or description, or a small sample of each candidate
   caption track. If the original spoken language is uncertain, do not silently
   choose a translated caption; try another extraction/transcription method or
   report this task as blocked/failed with the available caption languages and
   the reason you could not determine the source transcript.
   Many "silent" screen recordings still have captions or on-screen text
   captured as captions. If usable source-language captions exist, use them and
   do NOT run an audio check or skip.
2. Only if there are NO captions, probe THIS video's audio for speech, e.g.
   `ffmpeg -i <audio> -af volumedetect -f null -` and read mean_volume. A track
   that is near-silent (mean roughly below -50 dB) with no captions has no
   transcribable speech; an audible track must be transcribed (speech-to-text).

Never use video frames, screenshots, thumbnails, OCR, the title, or the
description as primary content.

Outcome for THIS video:
- Captions or transcribable speech available → extract the transcript as the
  body (meeting task.minimumContentQuality), summarize it, and set
  rawJson.transcriptSource (e.g. "agent-transcript" or the caption source).
- Genuinely no captions AND no audible speech → report it as a `skipped`
  taskOutcome carrying THIS video's own evidence, e.g.
  { meanVolumeDb: <measured>, hasCaptions: false }. Do not skip without that
  per-video evidence, and never reuse one video's evidence or reason for another.$$
WHERE "sourceId" = 'youtube'
  AND "fetchPromptBody" LIKE '%Primary content is the video''s TRANSCRIPT. Acquire it in this order:%'
  AND "fetchPromptBody" LIKE '%Captions first — official/creator captions or auto-captions%'
  AND "fetchPromptBody" NOT LIKE '%Do not default to English just because it%';

UPDATE "UserSourceTypeConfig"
SET "fetchPromptBody" = $$YouTube extraction — apply to EACH video on its own. Never infer one video's
content from another, and never skip a batch of videos based on a single
video's result. Run the checks below per video.

Primary content is the video's TRANSCRIPT. Acquire it in this order:
1. Captions first — official/creator captions or auto-captions (e.g. yt-dlp
   --write-auto-subs / --write-subs, or a transcript API).
   If multiple caption languages are available, choose the transcript in the
   video's original spoken language. Do not default to English just because it
   is available, listed first, or easier to download. Use only strong evidence:
   YouTube caption/translation metadata, the dominant language of the
   video/channel metadata or description, or a small sample of each candidate
   caption track. If the original spoken language is uncertain, do not silently
   choose a translated caption; try another extraction/transcription method or
   report this task as blocked/failed with the available caption languages and
   the reason you could not determine the source transcript.
   Many "silent" screen recordings still have captions or on-screen text
   captured as captions. If usable source-language captions exist, use them and
   do NOT run an audio check or skip.
2. Only if there are NO captions, probe THIS video's audio for speech, e.g.
   `ffmpeg -i <audio> -af volumedetect -f null -` and read mean_volume. A track
   that is near-silent (mean roughly below -50 dB) with no captions has no
   transcribable speech; an audible track must be transcribed (speech-to-text).

Never use video frames, screenshots, thumbnails, OCR, the title, or the
description as primary content.

Outcome for THIS video:
- Captions or transcribable speech available → extract the transcript as the
  body (meeting task.minimumContentQuality), summarize it, and set
  rawJson.transcriptSource (e.g. "agent-transcript" or the caption source).
- Genuinely no captions AND no audible speech → report it as a `skipped`
  taskOutcome carrying THIS video's own evidence, e.g.
  { meanVolumeDb: <measured>, hasCaptions: false }. Do not skip without that
  per-video evidence, and never reuse one video's evidence or reason for another.$$
WHERE "sourceId" = 'youtube'
  AND "fetchPromptBody" LIKE '%Primary content is the video''s TRANSCRIPT. Acquire it in this order:%'
  AND "fetchPromptBody" LIKE '%Captions first — official/creator captions or auto-captions%'
  AND "fetchPromptBody" NOT LIKE '%Do not default to English just because it%';
