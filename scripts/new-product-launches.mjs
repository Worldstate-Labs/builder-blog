#!/usr/bin/env node

import { isIP } from "node:net";

const MAX_LAUNCHES = 5;
const DEFAULT_TIMEOUT_MS = 8_000;
const FETCH_USER_AGENT = "BuilderBlogLaunchDiscovery/1.0 (+https://followbrief.worldstatelabs.com/)";
const PROVIDER_ORDER = ["hn", "dev", "huggingface", "lobsters"];
const TRACKING_PARAM_NAMES = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
  "src",
  "si",
  "spm",
  "trk",
  "utm_campaign",
  "utm_content",
  "utm_id",
  "utm_medium",
  "utm_name",
  "utm_source",
  "utm_term",
]);

/**
 * @typedef {{
 *   provider: "hn" | "dev" | "huggingface" | "lobsters",
 *   providerItemId: string,
 *   title: string,
 *   description: string,
 *   discussionUrl: string,
 *   officialUrl: string | null,
 *   author: string | null,
 *   publishedAt: string,
 *   engagement: number,
 *   tags: string[],
 *   providerUrls: Array<{ provider: string, url: string }>,
 *   providerPayloads: Array<{ provider: string, payload: unknown }>,
 *   dedupKey: string,
 *   rankEvidence: {
 *     engagementPercentile: number,
 *     freshnessScore: number,
 *     corroborationCount: number,
 *     score: number,
 *     tieBreakKey: string,
 *   },
 * }} NormalizedLaunchCandidate
 */

/**
 * @typedef {{
 *   provider: string,
 *   category: "http" | "network" | "parse" | "timeout",
 *   reason: string,
 * }} DiscoveryFailure
 */

/**
 * @typedef {{
 *   fetcher?: typeof fetch,
 *   now?: Date,
 *   lookbackDays: number,
 *   limit?: number,
 *   timeoutMs?: number,
 * }} LaunchDiscoveryOptions
 */

/**
 * @typedef {{
 *   launches: NormalizedLaunchCandidate[],
 *   failures: DiscoveryFailure[],
 * }} LaunchDiscoveryResult
 */

export class NewProductLaunchDiscoveryError extends Error {
  /**
   * @param {DiscoveryFailure[]} failures
   */
  constructor(failures) {
    super("All launch discovery providers failed");
    this.name = "NewProductLaunchDiscoveryError";
    this.code = "ALL_PROVIDERS_FAILED";
    /** @type {DiscoveryFailure[]} */
    this.failures = failures;
  }
}

/**
 * Score inputs are deterministic and pure:
 * - engagementPercentile: how many same-provider candidates this item beats
 * - freshnessScore: normalized age within the requested lookback
 * - corroborationScore: unique provider count beyond the first, capped at four
 *
 * @param {LaunchDiscoveryOptions} [options]
 * @returns {Promise<LaunchDiscoveryResult>}
 */
export async function discoverNewProductLaunches({
  fetcher = fetch,
  now = new Date(),
  lookbackDays,
  limit = 5,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const resolvedNow = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(resolvedNow.getTime())) {
    throw new TypeError("now must be a valid Date");
  }

  const resolvedLookbackDays = Number(lookbackDays);
  if (!Number.isFinite(resolvedLookbackDays) || resolvedLookbackDays < 1) {
    throw new RangeError("lookbackDays must be at least 1");
  }

  const resolvedLimit = Math.min(
    MAX_LAUNCHES,
    Math.max(1, Math.floor(Number(limit) || MAX_LAUNCHES)),
  );
  const resolvedTimeoutMs = clampPositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
  const cutoff = new Date(
    resolvedNow.getTime() - resolvedLookbackDays * 24 * 60 * 60 * 1000,
  );

  const providerResults = await Promise.allSettled([
    fetchHnLaunches({ fetcher, timeoutMs: resolvedTimeoutMs }),
    fetchDevLaunches({ fetcher, timeoutMs: resolvedTimeoutMs }),
    fetchHuggingFaceLaunches({ fetcher, timeoutMs: resolvedTimeoutMs }),
    fetchLobstersLaunches({ fetcher, timeoutMs: resolvedTimeoutMs }),
  ]);

  const successes = [];
  const failures = [];

  providerResults.forEach((result, index) => {
    const provider = PROVIDER_ORDER[index];
    if (result.status === "fulfilled") {
      successes.push(...result.value);
      return;
    }
    failures.push({ provider, ...categorizeDiscoveryError(result.reason) });
  });

  if (failures.length === PROVIDER_ORDER.length) {
    throw new NewProductLaunchDiscoveryError(failures);
  }

  const eligibleCandidates = successes.filter((candidate) =>
    isEligibleCandidate(candidate, { now: resolvedNow, cutoff }),
  );
  const mergedCandidates = mergeCandidates(eligibleCandidates);
  const rankedCandidates = rankCandidates(mergedCandidates, {
    now: resolvedNow,
    lookbackDays: resolvedLookbackDays,
  });

  return {
    launches: diversifyByPrimaryProvider(rankedCandidates, resolvedLimit),
    failures,
  };
}

async function fetchHnLaunches({ fetcher, timeoutMs }) {
  const storyIds = await fetchJson(
    fetcher,
    "https://hacker-news.firebaseio.com/v0/showstories.json",
    {
      timeoutMs,
      provider: "hn",
    },
  );
  const boundedIds = Array.isArray(storyIds)
    ? storyIds.filter((value) => Number.isFinite(Number(value))).slice(0, 12)
    : [];
  const items = await Promise.all(
    boundedIds.map((id) =>
      fetchJson(
        fetcher,
        `https://hacker-news.firebaseio.com/v0/item/${encodeURIComponent(String(id))}.json`,
        {
          timeoutMs,
          provider: "hn",
        },
      ),
    ),
  );

  return items.flatMap((item) => {
    if (!item || item.type !== "story" || !item.id || !item.title) return [];

    const officialUrl = normalizePublicHttpUrl(item.url);
    const publishedAt = fromUnixSeconds(item.time);
    if (!officialUrl || !publishedAt) return [];

    return [
      createCandidate({
        provider: "hn",
        providerItemId: String(item.id),
        title: String(item.title).trim(),
        description: stripHtml(String(item.text || "")).slice(0, 500),
        discussionUrl: `https://news.ycombinator.com/item?id=${encodeURIComponent(String(item.id))}`,
        officialUrl,
        author: normalizedString(item.by),
        publishedAt,
        engagement: finiteNumber(item.score),
        tags: ["show_hn"],
        payload: {
          id: item.id,
          by: item.by ?? null,
          score: item.score ?? 0,
          time: item.time ?? null,
          title: item.title,
          url: item.url ?? null,
        },
      }),
    ];
  });
}

async function fetchDevLaunches({ fetcher, timeoutMs }) {
  const articles = await fetchJson(
    fetcher,
    "https://dev.to/api/articles?tag=showdev&per_page=12",
    {
      timeoutMs,
      provider: "dev",
    },
  );
  if (!Array.isArray(articles)) return [];

  return articles.flatMap((article) => {
    const discussionUrl = normalizePublicHttpUrl(article?.url);
    const officialUrl = normalizePublicHttpUrl(article?.canonical_url);
    if (!discussionUrl || !officialUrl) return [];
    if (sameNormalizedUrl(discussionUrl, officialUrl)) return [];
    if (new URL(officialUrl).hostname === "dev.to") return [];

    const publishedAt = normalizedDate(
      article?.published_at || article?.published_timestamp,
    );
    const providerItemId = normalizedString(article?.id);
    const title = normalizedString(article?.title);
    if (!publishedAt || !providerItemId || !title) return [];

    return [
      createCandidate({
        provider: "dev",
        providerItemId,
        title,
        description: normalizedString(article?.description) || "",
        discussionUrl,
        officialUrl,
        author: normalizedString(article?.user?.username || article?.user?.name),
        publishedAt,
        engagement:
          finiteNumber(article?.positive_reactions_count) +
          finiteNumber(article?.comments_count) * 2,
        tags: normalizeTags(article?.tag_list),
        payload: {
          id: article.id,
          url: article.url ?? null,
          canonical_url: article.canonical_url ?? null,
          title: article.title ?? null,
          description: article.description ?? null,
          published_at: article.published_at ?? article.published_timestamp ?? null,
          positive_reactions_count: article.positive_reactions_count ?? 0,
          comments_count: article.comments_count ?? 0,
          user: article.user
            ? {
                username: article.user.username ?? null,
                name: article.user.name ?? null,
              }
            : null,
          tag_list: article.tag_list ?? [],
        },
      }),
    ];
  });
}

async function fetchHuggingFaceLaunches({ fetcher, timeoutMs }) {
  const spaces = await fetchJson(
    fetcher,
    "https://huggingface.co/api/spaces?sort=createdAt&direction=-1&limit=12",
    {
      timeoutMs,
      provider: "huggingface",
    },
  );
  if (!Array.isArray(spaces)) return [];

  return spaces.flatMap((space) => {
    if (space?.private) return [];

    const providerItemId = normalizedString(space?.id);
    const publishedAt = normalizedDate(space?.createdAt || space?.created_at);
    if (!providerItemId || !publishedAt) return [];

    const officialUrl = normalizePublicHttpUrl(
      `https://huggingface.co/spaces/${providerItemId}`,
    );
    if (!officialUrl) return [];

    const title =
      normalizedString(space?.cardData?.title) ||
      normalizedString(space?.title) ||
      normalizedString(space?.name) ||
      providerItemId;

    return [
      createCandidate({
        provider: "huggingface",
        providerItemId,
        title,
        description: normalizedString(space?.cardData?.short_description) || "",
        discussionUrl: officialUrl,
        officialUrl,
        author: normalizedString(space?.author),
        publishedAt,
        engagement: finiteNumber(space?.likes) + finiteNumber(space?.trendingScore),
        tags: normalizeTags(space?.tags || space?.cardData?.tags),
        payload: {
          id: space.id ?? null,
          title: space.title ?? space.cardData?.title ?? null,
          name: space.name ?? null,
          author: space.author ?? null,
          createdAt: space.createdAt ?? space.created_at ?? null,
          likes: space.likes ?? 0,
          trendingScore: space.trendingScore ?? 0,
          private: Boolean(space.private),
          tags: space.tags ?? space.cardData?.tags ?? [],
        },
      }),
    ];
  });
}

async function fetchLobstersLaunches({ fetcher, timeoutMs }) {
  const feedResults = await Promise.allSettled([
    fetchText(fetcher, "https://lobste.rs/t/show.rss", {
      timeoutMs,
      provider: "lobsters",
    }),
    fetchText(fetcher, "https://lobste.rs/t/announce.rss", {
      timeoutMs,
      provider: "lobsters",
    }),
  ]);

  const xmlBodies = feedResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  if (xmlBodies.length === 0) {
    const firstFailure = feedResults.find((result) => result.status === "rejected");
    throw firstFailure?.reason || new Error("No Lobsters feeds succeeded");
  }

  return xmlBodies.flatMap((xml) => parseLobstersFeed(xml));
}

function parseLobstersFeed(xml) {
  assertXmlDocument(xml, "lobsters");
  return extractXmlBlocks(xml, "item").flatMap((block) => {
    const discussionUrl = normalizePublicHttpUrl(tagText(block, "link"));
    const officialUrl = normalizePublicHttpUrl(
      extractFirstHref(tagText(block, "description")),
    );
    const publishedAt = normalizedDate(
      tagText(block, "pubDate") || tagText(block, "published"),
    );
    const providerItemId = normalizedString(tagText(block, "guid")) || discussionUrl;
    const title = stripHtml(tagText(block, "title") || "").trim();
    if (!discussionUrl || !officialUrl || !publishedAt || !providerItemId || !title) {
      return [];
    }

    const author =
      normalizedString(tagText(block, "author")) ||
      normalizedString(tagText(block, "dc:creator"));

    return [
      createCandidate({
        provider: "lobsters",
        providerItemId,
        title,
        description: stripHtml(tagText(block, "description") || "").slice(0, 500),
        discussionUrl,
        officialUrl,
        author,
        publishedAt,
        engagement: 1,
        tags: [],
        payload: {
          guid: providerItemId,
          link: discussionUrl,
          title,
          pubDate: publishedAt,
          author,
          officialUrl,
        },
      }),
    ];
  });
}

function createCandidate({
  provider,
  providerItemId,
  title,
  description,
  discussionUrl,
  officialUrl,
  author,
  publishedAt,
  engagement,
  tags,
  payload,
}) {
  const normalizedDiscussionUrl = normalizePublicHttpUrl(discussionUrl);
  const normalizedOfficialUrl = officialUrl ? normalizePublicHttpUrl(officialUrl) : null;
  if (!normalizedDiscussionUrl) {
    throw new TypeError(`Candidate ${provider}:${providerItemId} has no public discussion URL`);
  }

  return {
    provider,
    providerItemId,
    title: title.trim(),
    description: description.trim(),
    discussionUrl: normalizedDiscussionUrl,
    officialUrl: normalizedOfficialUrl,
    author: author || null,
    publishedAt,
    engagement: finiteNumber(engagement),
    tags: Array.from(
      new Set((tags || []).map((tag) => String(tag).trim()).filter(Boolean)),
    ).sort(),
    providerUrls: [{ provider, url: normalizedDiscussionUrl }],
    providerPayloads: [{ provider, payload }],
    dedupKey: normalizedOfficialUrl || `${provider}:${providerItemId}`,
    rankEvidence: {
      engagementPercentile: 0,
      freshnessScore: 0,
      corroborationCount: 1,
      score: 0,
      tieBreakKey: normalizedOfficialUrl || normalizedDiscussionUrl,
    },
  };
}

function isEligibleCandidate(candidate, { now, cutoff }) {
  if (!candidate?.title || !candidate?.discussionUrl || !candidate?.publishedAt) return false;

  const publishedAt = new Date(candidate.publishedAt);
  if (!Number.isFinite(publishedAt.getTime())) return false;
  if (publishedAt > now) return false;
  if (publishedAt < cutoff) return false;
  if (candidate.officialUrl && !normalizePublicHttpUrl(candidate.officialUrl)) return false;
  return true;
}

function mergeCandidates(candidates) {
  const merged = new Map();

  for (const candidate of candidates) {
    const existing = merged.get(candidate.dedupKey);
    if (!existing) {
      merged.set(candidate.dedupKey, {
        ...candidate,
        providerUrls: [...candidate.providerUrls],
        providerPayloads: [...candidate.providerPayloads],
        tags: [...candidate.tags],
      });
      continue;
    }

    existing.description = pickPreferredText(existing.description, candidate.description);
    existing.author = existing.author || candidate.author || null;
    existing.officialUrl = existing.officialUrl || candidate.officialUrl || null;
    existing.discussionUrl = existing.discussionUrl || candidate.discussionUrl;
    existing.publishedAt = pickNewestDate(existing.publishedAt, candidate.publishedAt);
    existing.engagement = Math.max(existing.engagement, candidate.engagement);
    existing.tags = Array.from(new Set([...existing.tags, ...candidate.tags])).sort();
    existing.providerUrls = mergeProviderUrls(existing.providerUrls, candidate.providerUrls);
    existing.providerPayloads = mergeProviderPayloads(
      existing.providerPayloads,
      candidate.providerPayloads,
    );
  }

  return [...merged.values()];
}

function rankCandidates(candidates, { now, lookbackDays }) {
  const providerEngagements = new Map();
  for (const provider of PROVIDER_ORDER) {
    providerEngagements.set(
      provider,
      candidates
        .filter((candidate) => candidate.provider === provider)
        .map((candidate) => candidate.engagement)
        .sort((left, right) => left - right),
    );
  }

  const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
  return [...candidates]
    .map((candidate) => {
      const engagementPercentile = engagementPercentileForValue(
        candidate.engagement,
        providerEngagements.get(candidate.provider) || [],
      );
      const ageMs = Math.max(
        0,
        now.getTime() - new Date(candidate.publishedAt).getTime(),
      );
      const freshnessScore = clampNumber(1 - ageMs / lookbackMs, 0, 1);
      const corroborationCount = new Set(
        candidate.providerUrls.map((entry) => entry.provider),
      ).size;
      const corroborationScore = clampNumber((corroborationCount - 1) / 3, 0, 1);
      const score = Number(
        (
          engagementPercentile * 0.5 +
          freshnessScore * 0.35 +
          corroborationScore * 0.15
        ).toFixed(6),
      );
      const tieBreakKey = candidate.officialUrl || candidate.discussionUrl || "";

      return {
        ...candidate,
        rankEvidence: {
          engagementPercentile,
          freshnessScore,
          corroborationCount,
          score,
          tieBreakKey,
        },
      };
    })
    .sort(
      (left, right) =>
        right.rankEvidence.score - left.rankEvidence.score ||
        left.rankEvidence.tieBreakKey.localeCompare(right.rankEvidence.tieBreakKey) ||
        left.providerItemId.localeCompare(right.providerItemId),
    );
}

function diversifyByPrimaryProvider(candidates, limit) {
  const selected = [];
  const deferred = [];
  const counts = new Map();

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const providerCount = counts.get(candidate.provider) || 0;
    const alternativesRemain = candidates
      .slice(index + 1)
      .some((next) => next.provider !== candidate.provider);

    if (providerCount >= 2 && alternativesRemain) {
      deferred.push(candidate);
      continue;
    }

    selected.push(candidate);
    counts.set(candidate.provider, providerCount + 1);
    if (selected.length === limit) return selected;
  }

  for (const candidate of deferred) {
    selected.push(candidate);
    if (selected.length === limit) break;
  }

  return selected.slice(0, limit);
}

async function fetchJson(fetcher, url, { timeoutMs, provider }) {
  const response = await timedFetch(fetcher, url, {
    timeoutMs,
    provider,
    headers: {
      accept: "application/json",
      "user-agent": FETCH_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw httpError(provider, response.status);
  }

  try {
    return await response.json();
  } catch {
    throw parseError(provider, "Invalid JSON response");
  }
}

async function fetchText(fetcher, url, { timeoutMs, provider }) {
  const response = await timedFetch(fetcher, url, {
    timeoutMs,
    provider,
    headers: {
      accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
      "user-agent": FETCH_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw httpError(provider, response.status);
  }
  return response.text();
}

async function timedFetch(fetcher, url, { timeoutMs, provider, headers }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, {
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw timeoutError(provider, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function categorizeDiscoveryError(error) {
  const category = allowlistedFailureCategory(error?.category, error?.name);
  return {
    category,
    reason: allowlistedFailureReason(error, category),
  };
}

function httpError(provider, status) {
  const error = new Error(`${provider} HTTP ${status}`);
  error.category = "http";
  error.reason = `HTTP ${status}`;
  return error;
}

function parseError(provider, reason) {
  const error = new Error(`${provider} parse failure`);
  error.category = "parse";
  error.reason = reason;
  return error;
}

function timeoutError(provider, timeoutMs) {
  const error = new Error(`${provider} timed out after ${timeoutMs}ms`);
  error.name = "AbortError";
  error.category = "timeout";
  error.reason = "timeout";
  return error;
}

function assertXmlDocument(xml, provider) {
  if (!/(<rss[\s>]|<feed[\s>])/i.test(String(xml || ""))) {
    throw parseError(provider, "invalid_xml");
  }
}

function normalizePublicHttpUrl(value) {
  if (!value) return null;

  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isPrivateHostname(url.hostname)) return null;

  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  const retainedParams = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(
      ([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
    );

  url.search = "";
  for (const [key, valueText] of retainedParams) {
    url.searchParams.append(key, valueText);
  }

  return url.toString();
}

function isTrackingParam(name) {
  const lowerName = String(name || "").toLowerCase();
  return lowerName.startsWith("utm_") || TRACKING_PARAM_NAMES.has(lowerName);
}

function isPrivateHostname(hostname) {
  const lower = normalizeHostname(hostname);
  if (!lower) return true;
  if (lower === "localhost" || lower.endsWith(".local") || lower.endsWith(".internal")) {
    return true;
  }

  const ipVersion = isIP(lower);
  if (ipVersion === 4) return isPrivateIpv4Hostname(lower);
  if (ipVersion === 6) return isPrivateIpv6Hostname(lower);
  return false;
}

function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
}

function isPrivateIpv4Hostname(hostname) {
  const octets = hostname.split(".").map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second] = octets;
  if (first === 10 || first === 127 || first === 0) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

function isPrivateIpv6Hostname(hostname) {
  const hextets = parseIpv6Hextets(hostname);
  if (!hextets) return true;
  if (hextets.every((part) => part === 0)) return true;
  if (hextets.slice(0, 7).every((part) => part === 0) && hextets[7] === 1) return true;
  if ((hextets[0] & 0xfe00) === 0xfc00) return true;
  if ((hextets[0] & 0xffc0) === 0xfe80) return true;
  if (isIpv4MappedIpv6(hextets)) {
    return isPrivateIpv4Hostname(ipv4FromMappedIpv6Hextets(hextets));
  }
  return false;
}

function parseIpv6Hextets(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return null;

  let working = normalized;
  if (working.includes(".")) {
    const lastColon = working.lastIndexOf(":");
    if (lastColon === -1) return null;
    const ipv4Tail = working.slice(lastColon + 1);
    if (!isIP(ipv4Tail) || isIP(ipv4Tail) !== 4) return null;
    const ipv4Hextets = ipv4Tail
      .split(".")
      .map((part) => Number(part))
      .reduce((result, octet, index, octets) => {
        if (index % 2 === 0) {
          result.push((octet << 8) | octets[index + 1]);
        }
        return result;
      }, []);
    working = `${working.slice(0, lastColon)}:${ipv4Hextets
      .map((part) => part.toString(16))
      .join(":")}`;
  }

  const doubleColonParts = working.split("::");
  if (doubleColonParts.length > 2) return null;
  const left = doubleColonParts[0]
    ? doubleColonParts[0].split(":").filter(Boolean)
    : [];
  const right = doubleColonParts[1]
    ? doubleColonParts[1].split(":").filter(Boolean)
    : [];
  const hasDoubleColon = doubleColonParts.length === 2;
  const missingCount = 8 - (left.length + right.length);
  if ((!hasDoubleColon && missingCount !== 0) || missingCount < 0) return null;

  const segments = [
    ...left,
    ...Array.from({ length: hasDoubleColon ? missingCount : 0 }, () => "0"),
    ...right,
  ];
  if (segments.length !== 8) return null;

  const hextets = segments.map((segment) => {
    if (!/^[0-9a-f]{1,4}$/i.test(segment)) return Number.NaN;
    return Number.parseInt(segment, 16);
  });
  return hextets.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
    ? hextets
    : null;
}

function isIpv4MappedIpv6(hextets) {
  return (
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0xffff
  );
}

function ipv4FromMappedIpv6Hextets(hextets) {
  return [
    hextets[6] >> 8,
    hextets[6] & 0xff,
    hextets[7] >> 8,
    hextets[7] & 0xff,
  ].join(".");
}

function allowlistedFailureCategory(category, errorName) {
  if (category === "http" || category === "parse" || category === "timeout") return category;
  if (errorName === "AbortError") return "timeout";
  return "network";
}

function allowlistedFailureReason(error, category) {
  if (category === "timeout") return "timeout";
  if (category === "network") return "network_error";
  if (category === "parse") {
    return error?.reason === "invalid_xml" ? "invalid_xml" : "invalid_json";
  }
  if (category === "http") {
    const safeStatus = Number(error?.status ?? String(error?.reason || "").match(/\d{3}/)?.[0]);
    if (Number.isInteger(safeStatus) && safeStatus >= 400 && safeStatus <= 599) {
      return `http_${safeStatus}`;
    }
    return "http_error";
  }
  return "network_error";
}

function sameNormalizedUrl(left, right) {
  return normalizePublicHttpUrl(left) === normalizePublicHttpUrl(right);
}

function normalizedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function fromUnixSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return normalizedDate(seconds * 1000);
}

function extractXmlBlocks(xml, tagName) {
  return [
    ...String(xml || "").matchAll(new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`, "gi")),
  ].map((match) => match[0]);
}

function tagText(block, tagName) {
  const escapedName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(block || "").match(
    new RegExp(`<${escapedName}\\b[^>]*>([\\s\\S]*?)<\\/${escapedName}>`, "i"),
  );
  return match ? decodeXmlEntities(match[1].trim()) : "";
}

function extractFirstHref(html) {
  const match = String(html || "").match(/href=["']([^"']+)["']/i);
  return match ? decodeXmlEntities(match[1]) : "";
}

function stripHtml(value) {
  return decodeXmlEntities(
    String(value || "")
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function mergeProviderUrls(left, right) {
  const merged = new Map();
  for (const entry of [...left, ...right]) {
    const key = `${entry.provider}\u0000${entry.url}`;
    if (!merged.has(key)) merged.set(key, entry);
  }
  return [...merged.values()].sort(
    (first, second) =>
      first.provider.localeCompare(second.provider) ||
      first.url.localeCompare(second.url),
  );
}

function mergeProviderPayloads(left, right) {
  const merged = new Map();
  for (const entry of [...left, ...right]) {
    const payloadId =
      normalizedString(entry?.payload?.id) ||
      normalizedString(entry?.payload?.guid) ||
      JSON.stringify(entry.payload);
    const key = `${entry.provider}\u0000${payloadId}`;
    if (!merged.has(key)) merged.set(key, entry);
  }
  return [...merged.values()].sort((first, second) =>
    first.provider.localeCompare(second.provider),
  );
}

function pickPreferredText(left, right) {
  if (!left) return right || "";
  if (!right) return left || "";
  return right.length > left.length ? right : left;
}

function pickNewestDate(left, right) {
  return new Date(left) >= new Date(right) ? left : right;
}

function engagementPercentileForValue(value, sortedValues) {
  if (!sortedValues.length) return 0;
  const lowerCount = sortedValues.filter((entry) => entry < value).length;
  return clampNumber(lowerCount / sortedValues.length, 0, 1);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizedString(value) {
  const text =
    typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return text || null;
}

export function isPrivateHostnameForTest(hostname) {
  return isPrivateHostname(hostname);
}

function clampPositiveInteger(value, fallback, min, max) {
  const resolved = Math.floor(Number(value));
  if (!Number.isFinite(resolved) || resolved <= 0) return fallback;
  return Math.min(max, Math.max(min, resolved));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
