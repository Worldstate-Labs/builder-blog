import { FeedItemKind } from "@prisma/client";
import type { CrawlerBuilder, CrawlOptions, CrawlSourceResult, Fetcher } from "./types";
import { asErrorMessage, decodeXmlText } from "./types";

const POD2TXT_BASE = "https://pod2txt.vercel.app/api";
const RSS_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PODCAST_LOOKBACK_HOURS = 336;

type Episode = {
  title: string;
  guid: string;
  publishedAt: string | null;
  link: string | null;
  transcriptUrl: string | null;
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
    if (guid) {
      episodes.push({
        title,
        guid,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
        link: link ?? null,
        transcriptUrl,
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

async function fetchTranscriptUrl(transcriptUrl: string, fetcher: Fetcher) {
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
        const result = episode.transcriptUrl
          ? await fetchTranscriptUrl(episode.transcriptUrl, fetcher)
          : options.pod2txtApiKey
            ? await fetchPod2txtTranscript(
                rssUrl,
                episode.guid,
                options.pod2txtApiKey,
                fetcher,
                options.maxTranscriptAttempts ?? 5,
                options.transcriptPollIntervalMs ?? 30000,
              )
            : { error: "POD2TXT_API_KEY is not configured and RSS transcript URL is unavailable" };
        if (result.error || !result.transcript) {
          errors.push(`Podcast: Transcript error for "${episode.title}": ${result.error ?? "empty transcript"}`);
          continue;
        }
        const youtubeUrl = builder.sourceUrl
          ? await findYouTubeEpisodeUrl(builder.sourceUrl, episode.title, fetcher)
          : null;
        items.push({
          builderId: builder.id,
          kind: FeedItemKind.PODCAST_EPISODE,
          externalId: episode.guid,
          title: episode.title,
          body: result.transcript,
          url: youtubeUrl ?? episode.link ?? builder.sourceUrl ?? rssUrl,
          publishedAt: episode.publishedAt ? new Date(episode.publishedAt) : null,
          sourceName: builder.name,
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
