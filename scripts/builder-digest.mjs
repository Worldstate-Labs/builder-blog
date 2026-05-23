#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONFIG_DIR = join(homedir(), ".builder-blog");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DEFAULT_APP_URL = "https://builder-blog.worldstatelabs.com";

function usage() {
  console.log(`builder-digest commands:
  login --app-url ${DEFAULT_APP_URL}
  crawl-personal [--days 3] [--limit 3] [--force]
  prepare [--days 1]
  sync-builders --file personal-builders.json
  sync --file digest.md [--title "AI Builder Digest"]
  status`);
}

async function readConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
}

async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function argValue(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

async function postJson(url, body, token) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && data.status !== "pending") {
    throw new Error(data.error || data.status || `HTTP ${response.status}`);
  }
  return data;
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore" });
  child.unref();
}

function requireLoggedIn(config) {
  if (!config.appUrl || !config.token) {
    throw new Error(`Not logged in. Run: builder-digest login --app-url ${DEFAULT_APP_URL}`);
  }
}

async function login(args) {
  const appUrl = argValue(args, "--app-url", process.env.BUILDER_BLOG_URL || DEFAULT_APP_URL).replace(/\/$/, "");
  const start = await postJson(`${appUrl}/api/device/start`, { appName: "Builder Blog skill" });
  console.log(`Open this URL to approve the terminal:\n${start.verificationUrl}\n`);
  console.log(`Code: ${start.code}`);
  openBrowser(start.verificationUrl);

  const deadline = Date.now() + (start.expiresInSeconds ?? 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const poll = await getJson(`${appUrl}/api/device/poll?code=${encodeURIComponent(start.code)}`);
    if (poll.status === "approved" && poll.token) {
      await saveConfig({ appUrl, token: poll.token });
      console.log(`Logged in. Config saved to ${CONFIG_PATH}`);
      return;
    }
    process.stdout.write(".");
  }
  throw new Error("Login timed out");
}

async function prepare(args) {
  const config = await readConfig();
  requireLoggedIn(config);
  const days = argValue(args, "--days", "1");
  const context = await getJson(`${config.appUrl}/api/skill/context?days=${encodeURIComponent(days)}`, config.token);
  console.log(JSON.stringify(context, null, 2));
}

async function crawlPersonal(args) {
  const config = await readConfig();
  requireLoggedIn(config);

  const days = Math.max(1, Number(argValue(args, "--days", "3")));
  const limit = Math.max(1, Number(argValue(args, "--limit", "3")));
  const force = args.includes("--force");
  const context = await getJson(
    `${config.appUrl}/api/skill/context?days=${encodeURIComponent(String(days))}`,
    config.token,
  );
  const subscribedBuilderIds = new Set(
    (context.subscriptions ?? []).map((builder) => builder.id),
  );
  const personalBuilders = personalBuildersForCrawl(context, { force });

  if (personalBuilders.length === 0) {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          builders: 0,
          feedItems: 0,
          skippedAlreadyCrawled: skippedPersonalBuilderCount(context),
          force,
          message: force
            ? "No personal BLOG or YouTube builders in this user's library."
            : "No uncrawled personal BLOG or YouTube builders. Use --force to crawl them again.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const builders = [];
  const localErrors = [];

  for (const builder of personalBuilders) {
    try {
      const items = isYouTubeBuilder(builder)
        ? await crawlPersonalYouTubeBuilder(builder, { cutoff, limit })
        : await crawlPersonalBlogBuilder(builder, { cutoff, limit });
      builders.push({
        kind: isYouTubeBuilder(builder) ? "PODCAST" : "BLOG",
        name: builder.name,
        handle: builder.handle,
        sourceUrl: builder.sourceUrl,
        crawlUrl: builder.crawlUrl,
        bio: builder.bio,
        subscribe: subscribedBuilderIds.has(builder.id),
        items,
      });
    } catch (error) {
      localErrors.push({
        builder: builder.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result = await postJson(
    `${config.appUrl}/api/skill/builders`,
    { force, builders },
    config.token,
  );
  console.log(
    JSON.stringify(
      {
        ...result,
        crawledPersonalBuilders: personalBuilders.length,
        skippedAlreadyCrawled: force ? 0 : skippedPersonalBuilderCount(context),
        localErrors,
      },
      null,
      2,
    ),
  );
}

export function personalBuildersForCrawl(context, { force = false } = {}) {
  const crawledBuilderIds = new Set(
    (context.personalCrawlStates ?? [])
      .filter((state) => state?.lastCrawledAt)
      .map((state) => state.builderId),
  );
  return (context.libraryBuilders ?? []).filter(
    (builder) =>
      builder.scope === "PERSONAL" &&
      (builder.kind === "BLOG" || isYouTubeBuilder(builder)) &&
      (force || !crawledBuilderIds.has(builder.id)),
  );
}

function skippedPersonalBuilderCount(context) {
  const forceEligibleBuilders = personalBuildersForCrawl(context, { force: true });
  const defaultBuilders = personalBuildersForCrawl(context, { force: false });
  return forceEligibleBuilders.length - defaultBuilders.length;
}

function isYouTubeBuilder(builder) {
  const source = `${builder.sourceUrl || ""} ${builder.crawlUrl || ""}`;
  return builder.kind === "PODCAST" && /youtube\.com|youtu\.be/i.test(source);
}

async function crawlPersonalYouTubeBuilder(builder, { cutoff, limit }) {
  const sourceUrl = builder.crawlUrl || builder.sourceUrl;
  if (!sourceUrl) return [];
  const feedUrl = await youtubeFeedUrl(sourceUrl);
  if (!feedUrl) {
    throw new Error(`Could not resolve a YouTube feed for ${sourceUrl}`);
  }

  const feedResponse = await fetch(feedUrl, {
    headers: { "User-Agent": "BuilderBlogSkill/1.0 (personal YouTube crawler)" },
  });
  if (!feedResponse.ok) {
    throw new Error(`Failed to fetch YouTube feed ${feedUrl}: HTTP ${feedResponse.status}`);
  }

  const videos = parseYouTubeFeed(await feedResponse.text(), feedUrl)
    .filter((video) => !video.publishedAt || new Date(video.publishedAt) >= cutoff)
    .slice(0, limit);
  const items = [];

  for (const video of videos) {
    const transcript = await fetchYouTubeTranscript(video.url).catch(() => "");
    const body = transcript || video.description || video.title;
    if (!body.trim()) continue;
    items.push({
      kind: "PODCAST_EPISODE",
      externalId: video.videoId || video.url,
      title: video.title || "Untitled YouTube update",
      body,
      url: video.url,
      publishedAt: video.publishedAt,
      sourceName: builder.name,
      rawJson: {
        source: "personal-youtube",
        builderId: builder.id,
        builderName: builder.name,
        title: video.title,
        url: video.url,
        publishedAt: video.publishedAt,
        transcriptSource: transcript ? "youtube-captions" : "youtube-feed-description",
      },
    });
  }

  return items;
}

async function crawlPersonalBlogBuilder(builder, { cutoff, limit }) {
  const indexUrl = builder.crawlUrl || builder.sourceUrl;
  if (!indexUrl) return [];

  const indexResponse = await fetch(indexUrl, {
    headers: { "User-Agent": "BuilderBlogSkill/1.0 (personal agent crawler)" },
  });
  if (!indexResponse.ok) {
    throw new Error(`Failed to fetch ${indexUrl}: HTTP ${indexResponse.status}`);
  }

  const indexBody = await indexResponse.text();
  const candidates = parseBlogCandidates(indexBody, indexUrl)
    .filter((article) => !article.publishedAt || new Date(article.publishedAt) >= cutoff)
    .slice(0, limit);
  const items = [];

  for (const article of candidates) {
    const articleResponse = await fetch(article.url, {
      headers: { "User-Agent": "BuilderBlogSkill/1.0 (personal agent crawler)" },
    });
    if (!articleResponse.ok) continue;

    const html = await articleResponse.text();
    const extracted = extractBlogArticle(html);
    const body = extracted.body || article.description;
    if (!body.trim()) continue;

    items.push({
      kind: "BLOG_POST",
      externalId: article.url,
      title: extracted.title || article.title || "Untitled",
      body,
      url: article.url,
      publishedAt: extracted.publishedAt || article.publishedAt,
      sourceName: builder.name,
      rawJson: {
        source: "personal-blog",
        builderId: builder.id,
        builderName: builder.name,
        title: extracted.title || article.title || "Untitled",
        url: article.url,
        publishedAt: extracted.publishedAt || article.publishedAt,
      },
    });
  }

  return items;
}

export function parseBlogCandidates(body, indexUrl) {
  if (/<rss[\s>]|<feed[\s>]/i.test(body)) {
    return parseFeedCandidates(body, indexUrl);
  }
  return parseHtmlCandidates(body, indexUrl);
}

function parseFeedCandidates(xml, indexUrl) {
  const itemMatches = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ];
  return dedupeByUrl(
    itemMatches.map((match) => {
      const block = match[0];
      const hrefMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
      const linkText = tagText(block, "link");
      return {
        title: tagText(block, "title"),
        url: absoluteUrl(hrefMatch?.[1] || linkText, indexUrl),
        publishedAt: normalizedDate(
          tagText(block, "pubDate") ||
            tagText(block, "published") ||
            tagText(block, "updated"),
        ),
        description: stripHtml(
          tagText(block, "description") ||
            tagText(block, "summary") ||
            tagText(block, "content:encoded"),
        ),
      };
    }),
  ).filter((candidate) => candidate.url);
}

function parseHtmlCandidates(html, indexUrl) {
  const base = new URL(indexUrl);
  const candidates = [];
  const linkRegex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = absoluteUrl(match[1], indexUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.origin !== base.origin || parsed.href === base.href) continue;
    if (!looksLikeArticlePath(parsed.pathname)) continue;
    candidates.push({
      title: stripHtml(match[2]),
      url: parsed.href,
      publishedAt: null,
      description: "",
    });
  }
  return dedupeByUrl(candidates);
}

export function extractBlogArticle(html) {
  const title =
    metaContent(html, "property", "og:title") ||
    metaContent(html, "name", "twitter:title") ||
    tagText(html, "h1") ||
    tagText(html, "title");
  const publishedAt = normalizedDate(
    metaContent(html, "property", "article:published_time") ||
      metaContent(html, "name", "date") ||
      metaContent(html, "itemprop", "datePublished"),
  );
  const articleMatch =
    html.match(/<article\b[\s\S]*?<\/article>/i) ||
    html.match(/<main\b[\s\S]*?<\/main>/i);
  const source = articleMatch?.[0] || html;
  const paragraphs = [...source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter((text) => text.length > 40);

  return {
    title: stripHtml(title),
    publishedAt,
    body: paragraphs.slice(0, 30).join("\n\n"),
  };
}

function looksLikeArticlePath(pathname) {
  return (
    /\/(blog|posts|post|news|article|articles|engineering|learn|writing)\//i.test(pathname) ||
    /\/20\d{2}\//.test(pathname)
  );
}

function tagText(text, tagName) {
  const escaped = escapeRegex(tagName);
  const match = text.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return decodeHtml(stripHtml(match?.[1] ?? ""));
}

function metaContent(html, attribute, value) {
  const regex = new RegExp(
    `<meta\\b(?=[^>]*\\b${attribute}=["']${escapeRegex(value)}["'])(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*>`,
    "i",
  );
  return decodeHtml(html.match(regex)?.[1] ?? "");
}

function stripHtml(html) {
  return decodeHtml(
    String(html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeHtml(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'");
}

function normalizedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";
  try {
    return new URL(value.trim(), baseUrl).href;
  } catch {
    return "";
  }
}

function dedupeByUrl(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.url || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function youtubeFeedUrl(sourceUrl, fetcher = fetch) {
  if (!sourceUrl) return "";
  const parsed = new URL(sourceUrl);
  if (parsed.pathname.includes("/feeds/videos.xml")) return parsed.href;
  const playlistId = parsed.searchParams.get("list");
  if (playlistId) {
    return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
  }
  const channelMatch = parsed.pathname.match(/\/channel\/([^/?]+)/);
  if (channelMatch) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelMatch[1])}`;
  }

  const response = await fetcher(parsed.href, {
    headers: {
      "User-Agent": "BuilderBlogSkill/1.0 (personal YouTube crawler)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) return "";
  const html = await response.text();
  const rssHref = html.match(/<link[^>]+type=["']application\/rss\+xml["'][^>]+href=["']([^"']+)["']/i)?.[1];
  if (rssHref) return decodeHtml(rssHref);
  const externalId = html.match(/"externalId"\s*:\s*"([^"]+)"/)?.[1];
  return externalId ? `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(externalId)}` : "";
}

export function parseYouTubeFeed(xml, feedUrl) {
  const entries = [
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
  ];
  return dedupeByUrl(
    entries.map((match) => {
      const block = match[0];
      const videoId = tagText(block, "yt:videoId") || tagText(block, "guid");
      const linkHref = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || tagText(block, "link");
      const url = absoluteUrl(linkHref || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ""), feedUrl);
      return {
        videoId: normalizeYouTubeVideoId(videoId) || youtubeVideoId(url),
        title: tagText(block, "title") || "Untitled YouTube update",
        url,
        publishedAt: normalizedDate(tagText(block, "published") || tagText(block, "updated") || tagText(block, "pubDate")),
        description: stripHtml(tagText(block, "media:description") || tagText(block, "description") || tagText(block, "summary")),
      };
    }),
  ).filter((candidate) => candidate.url);
}

async function fetchYouTubeTranscript(videoUrl, fetcher = fetch) {
  const videoId = youtubeVideoId(videoUrl);
  if (!videoId) return "";
  const response = await fetcher(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": "BuilderBlogSkill/1.0 (personal YouTube crawler)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) return "";
  const playerResponse = extractYouTubePlayerResponse(await response.text());
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return "";
  const track = preferredCaptionTrack(tracks);
  if (!track?.baseUrl) return "";
  const captionResponse = await fetcher(withYouTubeCaptionFormat(track.baseUrl, "json3"), {
    headers: {
      "User-Agent": "BuilderBlogSkill/1.0 (personal YouTube crawler)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!captionResponse.ok) return "";
  const body = await captionResponse.text();
  return body.trim().startsWith("{") ? parseYouTubeJsonTranscript(body) : parseYouTubeXmlTranscript(body);
}

function youtubeVideoId(videoUrl) {
  const urlMatch = videoUrl.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  if (urlMatch) return urlMatch[1];
  const shortMatch = videoUrl.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  return shortMatch ? shortMatch[1] : null;
}

function normalizeYouTubeVideoId(value) {
  const match = String(value || "").match(/([A-Za-z0-9_-]{6,})$/);
  return match ? match[1] : "";
}

function extractYouTubePlayerResponse(html) {
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
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
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

function preferredCaptionTrack(tracks) {
  const typedTracks = tracks.filter((track) => track && typeof track.baseUrl === "string");
  return (
    typedTracks.find((track) => track.languageCode?.startsWith("en") && track.kind !== "asr") ||
    typedTracks.find((track) => track.languageCode?.startsWith("en")) ||
    typedTracks.find((track) => track.kind !== "asr") ||
    typedTracks[0]
  );
}

function withYouTubeCaptionFormat(baseUrl, format) {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", format);
  return url.href;
}

function parseYouTubeJsonTranscript(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    return (data.events || [])
      .flatMap((event) => event.segs || [])
      .map((segment) => segment.utf8 || "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function parseYouTubeXmlTranscript(xml) {
  return [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((match) => decodeHtml(stripHtml(match[1])))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function sync(args) {
  const config = await readConfig();
  requireLoggedIn(config);

  const file = argValue(args, "--file");
  const title = argValue(args, "--title", `AI Builder Digest — ${new Date().toLocaleDateString()}`);
  let content = "";
  if (file) {
    content = await readFile(file, "utf8");
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    content = Buffer.concat(chunks).toString("utf8");
  }
  if (!content.trim()) throw new Error("Digest content is empty");

  const now = new Date();
  const result = await postJson(
    `${config.appUrl}/api/skill/digests`,
    {
      title,
      content,
      language: "zh",
      periodStart: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      periodEnd: now.toISOString(),
      itemCount: Number(argValue(args, "--item-count", "0")),
    },
    config.token,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function syncBuilders(args) {
  const config = await readConfig();
  requireLoggedIn(config);

  const file = argValue(args, "--file");
  if (!file) throw new Error("Missing --file personal-builders.json");
  const payload = JSON.parse(await readFile(file, "utf8"));
  const result = await postJson(`${config.appUrl}/api/skill/builders`, payload, config.token);
  console.log(JSON.stringify(result, null, 2));
}

async function status() {
  const config = await readConfig();
  console.log(
    JSON.stringify(
      {
        loggedIn: Boolean(config.appUrl && config.token),
        appUrl: config.appUrl ?? null,
        configPath: CONFIG_PATH,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "login") await login(args);
  else if (command === "crawl-personal") await crawlPersonal(args);
  else if (command === "prepare") await prepare(args);
  else if (command === "sync-builders") await syncBuilders(args);
  else if (command === "sync") await sync(args);
  else if (command === "status") await status();
  else usage();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
