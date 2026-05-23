import { FeedItemKind } from "@prisma/client";
import type { CrawlerBuilder, CrawlOptions, CrawlSourceResult, Fetcher } from "./types";
import { asErrorMessage, decodeXmlText } from "./types";

const POD2TXT_BASE = "https://pod2txt.vercel.app/api";
const RSS_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PODCAST_LOOKBACK_HOURS = 336;
const OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const OPENAI_TRANSCRIPTION_MAX_BYTES = 24 * 1024 * 1024;

type Episode = {
  title: string;
  guid: string;
  publishedAt: string | null;
  link: string | null;
  transcriptUrl: string | null;
  audioUrl: string | null;
  audioType: string | null;
};

type TranscriptResult = {
  transcript?: string;
  source?: string;
  error?: string;
};

export function parseRssFeed(xml: string): Episode[] {
  const episodes: Episode[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const block = itemMatch[1];
    const title = firstXmlValue(block, "title") ?? "Untitled";
    const guid = firstXmlValue(block, "guid");
    const pubDate = firstXmlValue(block, "pubDate");
    const link = firstXmlValue(block, "link");
    const transcriptUrl = firstTranscriptUrl(block);
    const enclosure = firstEnclosure(block);
    if (guid) {
      episodes.push({
        title,
        guid,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
        link: link ?? null,
        transcriptUrl,
        audioUrl: enclosure?.url ?? null,
        audioType: enclosure?.type ?? null,
      });
    }
  }
  return episodes;
}

function firstXmlValue(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlText(match[1]) : null;
}

function firstTranscriptUrl(block: string) {
  const match = block.match(/<(?:podcast:)?transcript\b[^>]*\burl=(["'])(.*?)\1[^>]*>/i);
  return match ? decodeXmlText(match[2]) : null;
}

function firstEnclosure(block: string) {
  const match = block.match(/<enclosure\b[^>]*>/i);
  if (!match) return null;
  const tag = match[0];
  const url = xmlAttribute(tag, "url");
  if (!url) return null;
  return {
    url,
    type: xmlAttribute(tag, "type"),
  };
}

function xmlAttribute(tag: string, attribute: string) {
  const match = tag.match(new RegExp(`\\b${attribute}=(["'])(.*?)\\1`, "i"));
  return match ? decodeXmlText(match[2]) : null;
}

async function fetchTranscriptUrl(transcriptUrl: string, fetcher: Fetcher): Promise<TranscriptResult> {
  const response = await fetcher(transcriptUrl, {
    headers: {
      "User-Agent": RSS_USER_AGENT,
      Accept: "text/plain, text/vtt, application/json, */*",
    },
  });
  if (!response.ok) {
    return { error: `Failed to fetch RSS transcript URL: HTTP ${response.status}` };
  }
  const transcript = await response.text();
  return transcript.trim()
    ? { transcript, source: "rss-transcript" }
    : { error: "RSS transcript URL returned an empty transcript" };
}

async function fetchYouTubeTranscript(videoUrl: string | null, fetcher: Fetcher): Promise<TranscriptResult> {
  const videoId = videoUrl ? youtubeVideoId(videoUrl) : null;
  if (!videoId) return { error: "YouTube episode URL is unavailable" };

  const watchResponse = await fetcher(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": RSS_USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!watchResponse.ok) {
    return { error: `Failed to fetch YouTube watch page: HTTP ${watchResponse.status}` };
  }

  const playerResponse = extractYouTubePlayerResponse(await watchResponse.text());
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return { error: "YouTube captions are unavailable" };
  }

  const track = preferredCaptionTrack(tracks);
  if (!track?.baseUrl || typeof track.baseUrl !== "string") {
    return { error: "YouTube caption URL is unavailable" };
  }

  const captionUrl = withYouTubeCaptionFormat(track.baseUrl, "json3");
  const captionResponse = await fetcher(captionUrl, {
    headers: {
      "User-Agent": RSS_USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!captionResponse.ok) {
    return { error: `Failed to fetch YouTube captions: HTTP ${captionResponse.status}` };
  }

  const captionText = await captionResponse.text();
  const transcript = captionResponse.headers.get("content-type")?.includes("json")
    ? parseYouTubeJsonTranscript(captionText)
    : parseYouTubeXmlTranscript(captionText);

  return transcript
    ? { transcript, source: "youtube-captions" }
    : { error: "YouTube captions returned an empty transcript" };
}

async function fetchOpenAiAudioTranscript(
  episode: Episode,
  fetcher: Fetcher,
  apiKey: string | null | undefined,
  maxAudioBytes: number,
): Promise<TranscriptResult> {
  if (!episode.audioUrl) return { error: "RSS audio enclosure is unavailable" };
  if (!apiKey) return { error: "OPENAI_API_KEY is not configured" };

  const headResponse = await fetcher(episode.audioUrl, {
    method: "HEAD",
    headers: { "User-Agent": RSS_USER_AGENT },
  }).catch(() => null);
  const contentLength = headResponse?.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxAudioBytes) {
    return {
      error: `RSS audio enclosure is too large for direct transcription (${contentLength} bytes)`,
    };
  }
  if (!contentLength && headResponse?.ok) {
    return { error: "RSS audio enclosure size is unknown" };
  }

  const audioResponse = await fetcher(episode.audioUrl, {
    headers: {
      "User-Agent": RSS_USER_AGENT,
      Accept: episode.audioType ?? "audio/*",
    },
  });
  if (!audioResponse.ok) {
    return { error: `Failed to fetch RSS audio enclosure: HTTP ${audioResponse.status}` };
  }

  const audioBuffer = await audioResponse.arrayBuffer();
  if (audioBuffer.byteLength > maxAudioBytes) {
    return {
      error: `RSS audio enclosure is too large for direct transcription (${audioBuffer.byteLength} bytes)`,
    };
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([audioBuffer], { type: episode.audioType ?? audioResponse.headers.get("content-type") ?? "audio/mpeg" }),
    `episode.${audioExtension(episode.audioUrl, episode.audioType ?? audioResponse.headers.get("content-type"))}`,
  );
  form.append("model", OPENAI_TRANSCRIPTION_MODEL);
  form.append("response_format", "json");

  const response = await fetcher("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { error: `OpenAI transcription failed: HTTP ${response.status}: ${text}` };
  }

  const data = (await response.json()) as { text?: string };
  return data.text?.trim()
    ? { transcript: data.text, source: "openai-audio-transcription" }
    : { error: "OpenAI transcription returned an empty transcript" };
}

async function fetchPod2txtTranscript(
  rssUrl: string,
  guid: string,
  apiKey: string,
  fetcher: Fetcher,
  maxAttempts: number,
  pollIntervalMs: number,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetcher(`${POD2TXT_BASE}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedurl: rssUrl, guid, apikey: apiKey }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { error: `HTTP ${response.status}: ${text}` };
    }
    const data = (await response.json()) as {
      status?: string;
      url?: string;
      message?: string;
    };
    if (data.status === "ready" && data.url) {
      const textResponse = await fetcher(data.url);
      if (!textResponse.ok) {
        return { error: `Failed to fetch transcript text: HTTP ${textResponse.status}` };
      }
      return { transcript: await textResponse.text(), source: "pod2txt" };
    }
    if (data.status === "processing") {
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      continue;
    }
    return { error: data.message || `Unexpected status: ${data.status}` };
  }
  return { error: "Timed out waiting for transcript processing" };
}

export async function crawlPodcastBuilders(
  builders: CrawlerBuilder[],
  options: CrawlOptions & {
    pod2txtApiKey?: string | null;
    openAiApiKey?: string | null;
    maxTranscriptAudioBytes?: number;
    maxTranscriptAttempts?: number;
    transcriptPollIntervalMs?: number;
  } = {},
): Promise<CrawlSourceResult> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const errors: string[] = [];
  const items: CrawlSourceResult["items"] = [];

  if (builders.length === 0) {
    return { source: "podcasts", builders: 0, items, errors };
  }

  const cutoff = new Date(now.getTime() - PODCAST_LOOKBACK_HOURS * 60 * 60 * 1000);
  for (const builder of builders) {
    const rssUrl = builder.crawlUrl ?? builder.sourceUrl;
    if (!rssUrl) {
      errors.push(`Podcast: No RSS URL configured for ${builder.name}`);
      continue;
    }
    try {
      const response = await fetcher(rssUrl, {
        headers: {
          "User-Agent": RSS_USER_AGENT,
          Accept: "application/rss+xml, application/xml, text/xml, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
        },
      });
      if (!response.ok) {
        errors.push(`Podcast: Failed to fetch RSS for ${builder.name}: HTTP ${response.status}`);
        continue;
      }
      const candidates = parseRssFeed(await response.text())
        .slice(0, 3)
        .filter((episode) => !episode.publishedAt || new Date(episode.publishedAt) >= cutoff)
        .sort((a, b) => {
          if (a.publishedAt && b.publishedAt) {
            return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
          }
          if (a.publishedAt) return -1;
          if (b.publishedAt) return 1;
          return 0;
      });

      for (const episode of candidates) {
        const youtubeUrl = builder.sourceUrl
          ? await findYouTubeEpisodeUrl(builder.sourceUrl, episode.title, fetcher)
          : null;
        const result = await fetchTranscriptForEpisode(episode, {
          rssUrl,
          youtubeUrl,
          fetcher,
          pod2txtApiKey: options.pod2txtApiKey,
          openAiApiKey: options.openAiApiKey ?? process.env.OPENAI_API_KEY,
          maxAudioBytes: options.maxTranscriptAudioBytes ?? OPENAI_TRANSCRIPTION_MAX_BYTES,
          maxAttempts: options.maxTranscriptAttempts ?? 5,
          pollIntervalMs: options.transcriptPollIntervalMs ?? 30000,
        });
        if (result.error || !result.transcript) {
          errors.push(`Podcast: Transcript error for "${episode.title}": ${result.error ?? "empty transcript"}`);
          continue;
        }
        items.push({
          builderId: builder.id,
          kind: FeedItemKind.PODCAST_EPISODE,
          externalId: episode.guid,
          title: episode.title,
          body: result.transcript,
          url: youtubeUrl ?? episode.link ?? builder.sourceUrl ?? rssUrl,
          publishedAt: episode.publishedAt ? new Date(episode.publishedAt) : null,
          sourceName: builder.name,
          crawlingTool: podcastCrawlingTool(result.source),
          rawJson: {
            source: "podcast",
            name: builder.name,
            title: episode.title,
            guid: episode.guid,
            url: youtubeUrl ?? episode.link ?? builder.sourceUrl ?? rssUrl,
            publishedAt: episode.publishedAt,
            transcriptSource: result.source ?? null,
            transcript: result.transcript,
          },
        });
        break;
      }
    } catch (error) {
      errors.push(`Podcast: Error processing ${builder.name}: ${asErrorMessage(error)}`);
    }
  }

  return { source: "podcasts", builders: builders.length, items, errors };
}

function podcastCrawlingTool(source: string | null | undefined) {
  if (source === "openai-audio-transcription") return "OpenAI audio transcriptions API";
  if (source === "youtube-captions") return "YouTube captions API";
  if (source === "pod2txt") return "pod2txt transcript API";
  if (source === "rss-transcript") return "Podcast RSS transcript";
  return "Builder Blog podcast transcript crawler";
}

async function fetchTranscriptForEpisode(
  episode: Episode,
  options: {
    rssUrl: string;
    youtubeUrl: string | null;
    fetcher: Fetcher;
    pod2txtApiKey?: string | null;
    openAiApiKey?: string | null;
    maxAudioBytes: number;
    maxAttempts: number;
    pollIntervalMs: number;
  },
): Promise<TranscriptResult> {
  const attempts: Array<() => Promise<TranscriptResult>> = [];
  if (episode.transcriptUrl) {
    attempts.push(() => fetchTranscriptUrl(episode.transcriptUrl!, options.fetcher));
  }
  if (options.youtubeUrl) {
    attempts.push(() => fetchYouTubeTranscript(options.youtubeUrl, options.fetcher));
  }
  if (episode.audioUrl) {
    attempts.push(() =>
      fetchOpenAiAudioTranscript(episode, options.fetcher, options.openAiApiKey, options.maxAudioBytes),
    );
  }
  if (options.pod2txtApiKey) {
    attempts.push(() =>
      fetchPod2txtTranscript(
        options.rssUrl,
        episode.guid,
        options.pod2txtApiKey!,
        options.fetcher,
        options.maxAttempts,
        options.pollIntervalMs,
      ),
    );
  } else {
    attempts.push(async () => ({
      error: "POD2TXT_API_KEY is not configured and no transcript source succeeded",
    }));
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    const result: TranscriptResult = await attempt().catch((error) => ({ error: asErrorMessage(error) }));
    if (result.transcript?.trim()) return result;
    if (result.error) errors.push(result.error);
  }
  return { error: errors.join("; ") || "No transcript source succeeded" };
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function findYouTubeEpisodeUrl(channelUrl: string, episodeTitle: string, fetcher: Fetcher) {
  if (!channelUrl.includes("youtube.com")) return null;
  const feedUrl = await youtubeFeedUrl(channelUrl, fetcher);
  try {
    let videos: Array<{ title: string; url: string }> = [];
    if (feedUrl) {
      const response = await fetcher(feedUrl, { headers: { "User-Agent": RSS_USER_AGENT } });
      if (response.ok) {
        videos = parseYouTubeFeed(await response.text());
      }
    }
    if (videos.length === 0) {
      const videosPage = channelUrl.includes("/playlist?")
        ? channelUrl
        : channelUrl.replace(/\/$/, "") + "/videos";
      const response = await fetcher(videosPage, {
        headers: {
          "User-Agent": RSS_USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (response.ok) {
        videos = parseYouTubePageData(await response.text());
      }
    }
    if (videos.length === 0) return null;
    const needle = normalizeTitle(episodeTitle);
    const needleTokens = new Set(needle.split(" ").filter((word) => word.length > 2));
    let bestUrl: string | null = null;
    let bestScore = 0;
    for (const video of videos) {
      const hay = normalizeTitle(video.title);
      if (hay.includes(needle) || needle.includes(hay)) return video.url;
      const hayTokens = new Set(hay.split(" ").filter((word) => word.length > 2));
      let overlap = 0;
      for (const token of needleTokens) {
        if (hayTokens.has(token)) overlap += 1;
      }
      const score = needleTokens.size ? overlap / needleTokens.size : 0;
      if (score > bestScore) {
        bestScore = score;
        bestUrl = video.url;
      }
    }
    return bestScore >= 0.5 ? bestUrl : null;
  } catch {
    return null;
  }
}

function youtubeVideoId(videoUrl: string) {
  const urlMatch = videoUrl.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (urlMatch) return urlMatch[1];
  const shortMatch = videoUrl.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  return shortMatch ? shortMatch[1] : null;
}

function extractYouTubePlayerResponse(html: string) {
  const assignment = html.match(/ytInitialPlayerResponse\s*=\s*/);
  if (!assignment) return null;
  const start = html.indexOf("{", assignment.index);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function preferredCaptionTrack(tracks: unknown[]) {
  const typedTracks = tracks.filter(
    (track): track is { baseUrl: string; languageCode?: string; kind?: string } =>
      typeof track === "object" &&
      track !== null &&
      "baseUrl" in track &&
      typeof (track as { baseUrl?: unknown }).baseUrl === "string",
  );
  return (
    typedTracks.find((track) => track.languageCode?.startsWith("en") && track.kind !== "asr") ??
    typedTracks.find((track) => track.languageCode?.startsWith("en")) ??
    typedTracks.find((track) => track.kind !== "asr") ??
    typedTracks[0]
  );
}

function withYouTubeCaptionFormat(baseUrl: string, format: string) {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return baseUrl.includes("fmt=") ? baseUrl : `${baseUrl}${separator}fmt=${format}`;
}

function parseYouTubeJsonTranscript(text: string) {
  try {
    const data = JSON.parse(text) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
    return (data.events ?? [])
      .flatMap((event) => event.segs ?? [])
      .map((segment) => segment.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function parseYouTubeXmlTranscript(xml: string) {
  const lines: string[] = [];
  const textRegex = /<text\b[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(xml)) !== null) {
    lines.push(decodeXmlText(match[1]));
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

function audioExtension(audioUrl: string, contentType: string | null) {
  const extension = audioUrl.match(/\.([a-z0-9]{2,4})(?:[?#]|$)/i)?.[1]?.toLowerCase();
  if (extension && ["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"].includes(extension)) {
    return extension;
  }
  if (contentType?.includes("mp4")) return "mp4";
  if (contentType?.includes("m4a")) return "m4a";
  if (contentType?.includes("ogg")) return "ogg";
  if (contentType?.includes("wav")) return "wav";
  if (contentType?.includes("webm")) return "webm";
  return "mp3";
}

async function youtubeFeedUrl(channelUrl: string, fetcher: Fetcher) {
  const playlist = channelUrl.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (playlist) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlist[1]}`;
  const channel = channelUrl.match(/\/channel\/(UC[A-Za-z0-9_-]+)/);
  if (channel) return `https://www.youtube.com/feeds/videos.xml?channel_id=${channel[1]}`;
  if (channelUrl.match(/\/@[A-Za-z0-9_.-]+/)) {
    try {
      const response = await fetcher(channelUrl, {
        headers: {
          "User-Agent": RSS_USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (!response.ok) return null;
      const html = await response.text();
      const idMatch =
        html.match(/"channelId":"(UC[A-Za-z0-9_-]{20,})"/) ||
        html.match(/"browseId":"(UC[A-Za-z0-9_-]{20,})"/) ||
        html.match(/"externalId":"(UC[A-Za-z0-9_-]{20,})"/) ||
        html.match(/<meta\s+itemprop="(?:identifier|channelId)"\s+content="(UC[A-Za-z0-9_-]{20,})"/);
      return idMatch ? `https://www.youtube.com/feeds/videos.xml?channel_id=${idMatch[1]}` : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseYouTubeFeed(xml: string) {
  const videos: Array<{ title: string; url: string }> = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch: RegExpExecArray | null;
  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const block = entryMatch[1];
    const title = firstXmlValue(block, "title");
    const videoId = firstXmlValue(block, "yt:videoId");
    if (title && videoId) {
      videos.push({ title, url: `https://www.youtube.com/watch?v=${videoId}` });
    }
  }
  return videos;
}

function parseYouTubePageData(html: string) {
  const videos: Array<{ title: string; url: string }> = [];
  const videoRegex =
    /"videoId":"([A-Za-z0-9_-]{6,})"[\s\S]{0,600}?"title":\{"runs":\[\{"text":"([^"]+)"/g;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = videoRegex.exec(html)) !== null) {
    const [, videoId, title] = match;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    videos.push({
      title: title.replace(/\\"/g, '"'),
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
  return videos;
}
