// One-time seed: set the YouTube source's admin-editable fetch prompt
// (SourceTypeConfig.fetchPromptBody) to captions-first, per-video extraction
// guidance. Intentionally NOT in config/sources.json — this is data the admin
// can later override in Settings. Idempotent (re-running just re-sets the text).
//
// Run: set -a && . ./.env.local && set +a && npx tsx scripts/seed-youtube-fetch-prompt.mts

import { getSourceConfig, updateSourceConfig } from "../src/lib/source-config-store";

const YOUTUBE_FETCH_PROMPT = `YouTube extraction — apply to EACH video on its own. Never infer one video's
content from another, and never skip a batch of videos based on a single
video's result. Run the checks below per video.

Primary content is the video's TRANSCRIPT. Acquire it in this order:
1. Captions first — official/creator captions or auto-captions (e.g. yt-dlp
   --write-auto-subs / --write-subs, or a transcript API). Many "silent" screen
   recordings still have captions or on-screen text captured as captions. If
   usable captions exist, use them and do NOT run an audio check or skip.
2. Only if there are NO captions, probe THIS video's audio for speech, e.g.
   \`ffmpeg -i <audio> -af volumedetect -f null -\` and read mean_volume. A track
   that is near-silent (mean roughly below -50 dB) with no captions has no
   transcribable speech; an audible track must be transcribed (speech-to-text).

Never use video frames, screenshots, thumbnails, OCR, the title, or the
description as primary content.

Outcome for THIS video:
- Captions or transcribable speech available → extract the transcript as the
  body (meeting task.minimumContentQuality), summarize it, and set
  rawJson.transcriptSource (e.g. "agent-transcript" or the caption source).
- Genuinely no captions AND no audible speech → report it as a \`skipped\`
  taskOutcome carrying THIS video's own evidence, e.g.
  { meanVolumeDb: <measured>, hasCaptions: false }. Do not skip without that
  per-video evidence, and never reuse one video's evidence or reason for another.`;

async function main() {
  const before = await getSourceConfig("youtube");
  if (!before) {
    throw new Error(
      "No 'youtube' SourceTypeConfig row found. Ensure source configs are seeded first.",
    );
  }
  await updateSourceConfig("youtube", { fetchPromptBody: YOUTUBE_FETCH_PROMPT }, "seed-script");
  const after = await getSourceConfig("youtube");
  console.log(
    `youtube fetchPromptBody set (${after?.fetchPromptBody?.length ?? 0} chars). ` +
      `Admin can override it in Settings.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
