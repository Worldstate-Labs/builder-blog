UPDATE "DigestConfig"
SET "commonFetchRules" = $$Use `task.item.url`, `task.sourceType`, and `task.agentWorkType` to pick any extraction method available: web fetch, local CLI tools (yt-dlp, curl, ffmpeg, headless browser, etc.), transcription APIs - anything you have.

Keep trying available methods until real primary content that meets `task.minimumContentQuality` is obtained, or no method remains.

Primary content means content from `task.item.url`, the same origin, or a canonical/redirect URL reached from `task.item.url`. Do not use web search snippets or related reporting from another publisher/domain as replacement content for a blocked primary source. If primary content cannot be obtained, write a structured failed taskOutcome with reason `primary_content_unavailable` and evidence describing the blocked URL and attempted methods.$$;

UPDATE "UserDigestConfig"
SET "commonFetchRules" = $$Use `task.item.url`, `task.sourceType`, and `task.agentWorkType` to pick any extraction method available: web fetch, local CLI tools (yt-dlp, curl, ffmpeg, headless browser, etc.), transcription APIs - anything you have.

Keep trying available methods until real primary content that meets `task.minimumContentQuality` is obtained, or no method remains.

Primary content means content from `task.item.url`, the same origin, or a canonical/redirect URL reached from `task.item.url`. Do not use web search snippets or related reporting from another publisher/domain as replacement content for a blocked primary source. If primary content cannot be obtained, write a structured failed taskOutcome with reason `primary_content_unavailable` and evidence describing the blocked URL and attempted methods.$$;
