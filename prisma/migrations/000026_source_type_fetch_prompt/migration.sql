-- Per-source-type fetch prompt. Optional column: null/empty means "no
-- agent fetch instructions; CLI deterministic behavior is authoritative".
-- Non-empty means "the agent receives this prompt when handling a
-- fallback fetch task for this source type, and can act on it (e.g.
-- download audio + ASR for podcasts)".
ALTER TABLE "SourceTypeConfig" ADD COLUMN "fetchPromptBody" TEXT;

-- Seed the podcast default. Mirrors DEFAULT_PODCAST_FETCH_PROMPT in
-- src/lib/digest-prompts.ts; keep these in sync.
UPDATE "SourceTypeConfig"
SET "fetchPromptBody" = $$# Podcast Fetch Prompt

You are fetching one podcast episode for FollowBrief. Decide which
content to send back as the item body using the inputs supplied with
the task (episode title, episode URL, audio enclosure URL, and the show
notes text extracted from the RSS `<item>`).

## Decision

1. If show notes are substantial — ≥ 500 characters of body copy, with
   paragraph structure or speaker bullets, not just a one-line tagline,
   ad copy, or a list of social handles — use the show notes verbatim
   as the item body.
2. Otherwise, fall back to audio:
   - Download the audio enclosure to a temp file on the local machine.
   - Run OpenAI Whisper (or another local ASR you have configured) on
     the audio to produce a full transcript.
   - Use the transcript as the item body. Mark `rawJson.transcriptSource`
     as `openai-audio-transcription` (or the equivalent string for your
     ASR) so the server's content-quality checks accept it.
   - After the transcript is uploaded, DELETE the audio file and the
     raw transcript from the temp dir. Do not persist either to disk
     beyond the current task.

## Output rules

- The item URL must be the specific episode page (RSS `<link>` or the
  podcast platform's per-episode URL). Never link to the channel page.
- Do not invent a transcript when none can be produced; fail the task
  with a clear reason instead.
- Do not summarize at this stage — that happens in a later step. Send
  the full transcript (or full show-notes block) as the body.
$$
WHERE "sourceId" = 'podcast';
