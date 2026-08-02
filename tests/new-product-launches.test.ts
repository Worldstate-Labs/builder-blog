import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  discoverNewProductLaunches,
  isPrivateHostnameForTest,
  NewProductLaunchDiscoveryError,
} from "../scripts/new-product-launches.mjs";

const NOW = new Date("2026-08-02T12:00:00.000Z");
const LOOKBACK_DAYS = 14;

type DiscoveryResult = Awaited<ReturnType<typeof discoverNewProductLaunches>>;
type Launch = DiscoveryResult["launches"][number];
type DiscoveryFailure = DiscoveryResult["failures"][number];
type RankCandidatesForTest = (
  candidates: Array<Omit<Launch, "discussionUrl"> & { discussionUrl?: string }>,
  options: { now: Date; lookbackDays: number },
) => Launch[];

type FixtureValue = Response | Error | Record<string, unknown> | unknown[] | string | number[];

type DiscoveryFixtures = {
  hnStories?: FixtureValue;
  hnItems?: Record<string, FixtureValue>;
  devArticles?: FixtureValue;
  hfSpaces?: FixtureValue;
  lobstersShow?: FixtureValue;
  lobstersAnnounce?: FixtureValue;
};

function daysAgo(days: number, hour = 12) {
  return new Date(Date.UTC(2026, 7, 2 - days, hour, 0, 0)).toISOString();
}

function unixSeconds(iso: string) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

function abortError(message = "aborted") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function textResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    ...init,
    headers: { "content-type": "text/plain; charset=utf-8", ...(init.headers || {}) },
  });
}

function rssResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    ...init,
    headers: { "content-type": "application/rss+xml; charset=utf-8", ...(init.headers || {}) },
  });
}

function toResponse(value: FixtureValue | undefined, defaultValue: unknown) {
  if (value instanceof Response) return value;
  if (value instanceof Error) throw value;
  if (typeof value === "string") return textResponse(value);
  if (value !== undefined) return jsonResponse(value);
  return jsonResponse(defaultValue);
}

function createFixtureFetcher(fixtures: DiscoveryFixtures = {}) {
  return async (input: string | URL | Request) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(rawUrl);

    if (
      url.hostname === "hacker-news.firebaseio.com" &&
      url.pathname === "/v0/showstories.json"
    ) {
      return toResponse(fixtures.hnStories, []);
    }

    if (
      url.hostname === "hacker-news.firebaseio.com" &&
      /^\/v0\/item\/\d+\.json$/.test(url.pathname)
    ) {
      const itemId = url.pathname.match(/\/(\d+)\.json$/)?.[1];
      const item = itemId ? fixtures.hnItems?.[itemId] : undefined;
      if (item instanceof Error) throw item;
      if (item instanceof Response) return item;
      return item !== undefined ? jsonResponse(item) : new Response("missing", { status: 404 });
    }

    if (url.hostname === "dev.to" && url.pathname === "/api/articles") {
      return toResponse(fixtures.devArticles, []);
    }

    if (url.hostname === "huggingface.co" && url.pathname === "/api/spaces") {
      return toResponse(fixtures.hfSpaces, []);
    }

    if (url.hostname === "lobste.rs" && url.pathname === "/t/show.rss") {
      const body = fixtures.lobstersShow ?? "<rss><channel></channel></rss>";
      if (body instanceof Error) throw body;
      if (body instanceof Response) return body;
      return rssResponse(String(body));
    }

    if (url.hostname === "lobste.rs" && url.pathname === "/t/announce.rss") {
      const body = fixtures.lobstersAnnounce ?? "<rss><channel></channel></rss>";
      if (body instanceof Error) throw body;
      if (body instanceof Response) return body;
      return rssResponse(String(body));
    }

    throw new Error(`Unexpected URL: ${url.href}`);
  };
}

function hnItem({
  id,
  title,
  url,
  by,
  iso,
  score,
  text,
}: {
  id: number;
  title: string;
  url?: string;
  by: string;
  iso: string;
  score: number;
  text?: string;
}) {
  return {
    id,
    type: "story",
    title,
    url,
    by,
    time: unixSeconds(iso),
    score,
    text,
  };
}

function devArticle({
  id,
  title,
  officialUrl,
  discussionUrl,
  author,
  iso,
  description,
  reactions,
  comments,
  tags,
}: {
  id: number;
  title: string;
  officialUrl?: string | null;
  discussionUrl?: string;
  author: string;
  iso: string;
  description: string;
  reactions: number;
  comments: number;
  tags?: string[];
}) {
  return {
    id,
    title,
    description,
    url: discussionUrl ?? `https://dev.to/${author}/launch-${id}`,
    canonical_url: officialUrl ?? null,
    published_at: iso,
    positive_reactions_count: reactions,
    comments_count: comments,
    tag_list: (tags ?? ["showdev"]).join(", "),
    user: {
      name: author,
      username: author,
    },
  };
}

function hfSpace({
  id,
  title,
  author,
  iso,
  likes,
  trendingScore,
  tags,
  privateSpace = false,
}: {
  id: string;
  title: string;
  author: string;
  iso: string;
  likes: number;
  trendingScore: number;
  tags?: string[];
  privateSpace?: boolean;
}) {
  return {
    id,
    name: id.split("/")[1],
    title,
    author,
    createdAt: iso,
    likes,
    trendingScore,
    private: privateSpace,
    tags: tags ?? ["demo"],
    cardData: {
      title,
      short_description: `${title} short description`,
      tags: tags ?? ["demo"],
    },
  };
}

function lobstersFeed(items: Array<{
  title: string;
  discussionUrl: string;
  officialUrl?: string;
  author: string;
  iso: string;
  guid: string;
  description?: string;
  commentsUrl?: string | null;
  descriptionHref?: string;
}>) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        ${items
          .map((item) => {
            const fallbackHref = item.descriptionHref ?? item.officialUrl ?? item.discussionUrl;
            const linkedText = fallbackHref
              ? `<a href="${fallbackHref}">${item.title}</a>`
              : "";
            return `<item>
              <title>${item.title}</title>
              <link>${item.officialUrl ?? item.discussionUrl}</link>
              ${item.commentsUrl === null ? "" : `<comments>${item.commentsUrl ?? item.discussionUrl}</comments>`}
              <guid>${item.guid}</guid>
              <pubDate>${new Date(item.iso).toUTCString()}</pubDate>
              <author>${item.author}</author>
              <description><![CDATA[${linkedText}${item.description ?? ""}]]></description>
            </item>`;
          })
          .join("\n")}
      </channel>
    </rss>`;
}

let rankCandidatesForTestPromise: Promise<RankCandidatesForTest> | null = null;

async function loadRankCandidatesForTest() {
  if (!rankCandidatesForTestPromise) {
    rankCandidatesForTestPromise = (async () => {
      const moduleSource = await readFile(
        new URL("../scripts/new-product-launches.mjs", import.meta.url),
        "utf8",
      );
      const instrumentedModule = await import(
        `data:text/javascript;base64,${Buffer.from(
          `${moduleSource}\nexport { rankCandidates as rankCandidatesForTest };`,
        ).toString("base64")}`
      );
      return instrumentedModule.rankCandidatesForTest as RankCandidatesForTest;
    })();
  }

  return rankCandidatesForTestPromise;
}

test("parses Show HN, DEV showdev, Hugging Face Spaces, and Lobsters", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [101],
      hnItems: {
        "101": hnItem({
          id: 101,
          title: "Ship Alpha",
          url: "https://alpha.example/?utm_source=hn&utm_medium=social#hero",
          by: "alice",
          iso: daysAgo(1),
          score: 55,
        }),
      },
      devArticles: [
        devArticle({
          id: 201,
          title: "Show DEV: Ship Beta",
          officialUrl: "https://beta.example/product?utm_campaign=launch&a=2&z=1",
          discussionUrl: "https://dev.to/beta/showdev-ship-beta-201",
          author: "beta",
          iso: daysAgo(2),
          description: "Beta is live for builders.",
          reactions: 41,
          comments: 7,
          tags: ["showdev", "launch"],
        }),
      ],
      hfSpaces: [
        hfSpace({
          id: "carol/gamma-space",
          title: "Gamma Space",
          author: "carol",
          iso: daysAgo(3),
          likes: 28,
          trendingScore: 91,
          tags: ["agents", "demo"],
        }),
      ],
      lobstersShow: lobstersFeed([
        {
          title: "Delta Demo",
          discussionUrl: "https://lobste.rs/s/delta123/delta_demo",
          officialUrl: "https://delta.example/launch?ref=lobsters&utm_source=rss",
          author: "dan",
          iso: daysAgo(4),
          guid: "delta-123",
          description: " Discussing the public launch.",
        },
      ]),
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.launches.length, 4);

  const byTitle = new Map<string, Launch>(
    result.launches.map((launch: Launch) => [launch.title, launch]),
  );

  assert.equal(byTitle.get("Ship Alpha")?.officialUrl, "https://alpha.example/");
  assert.equal(byTitle.get("Ship Alpha")?.discussionUrl, "https://news.ycombinator.com/item?id=101");
  assert.equal(byTitle.get("Show DEV: Ship Beta")?.officialUrl, "https://beta.example/product?a=2&z=1");
  assert.equal(byTitle.get("Show DEV: Ship Beta")?.discussionUrl, "https://dev.to/beta/showdev-ship-beta-201");
  assert.equal(
    byTitle.get("Gamma Space")?.officialUrl,
    "https://huggingface.co/spaces/carol/gamma-space",
  );
  assert.equal(
    byTitle.get("Delta Demo")?.officialUrl,
    "https://delta.example/launch?ref=lobsters",
  );
  assert.equal(
    byTitle.get("Delta Demo")?.discussionUrl,
    "https://lobste.rs/s/delta123/delta_demo",
  );
  assert.deepEqual(
    result.launches.map((launch: Launch) => launch.provider).sort(),
    ["dev", "hn", "huggingface", "lobsters"],
  );
});

test("uses Lobsters link/comments fields first and falls back to description links only when needed", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      lobstersShow: lobstersFeed([
        {
          title: "Live Contract",
          officialUrl: "https://live-contract.example/product?source=lobsters&utm_source=rss",
          discussionUrl: "https://lobste.rs/s/live123/live_contract",
          author: "rss",
          iso: daysAgo(1),
          guid: "live-contract",
          description: " Live-shaped RSS item.",
        },
        {
          title: "Fallback Discussion",
          officialUrl: "https://fallback-discussion.example/story?ref=lobsters&utm_campaign=feed",
          commentsUrl: null,
          discussionUrl: "https://lobste.rs/s/fallback2/fallback_discussion",
          descriptionHref: "https://lobste.rs/s/fallback2/fallback_discussion",
          author: "rss",
          iso: daysAgo(1),
          guid: "fallback-discussion",
          description: " Missing comments field.",
        },
      ]),
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  const byTitle = new Map<string, Launch>(
    result.launches.map((launch: Launch) => [launch.title, launch]),
  );

  assert.equal(
    byTitle.get("Live Contract")?.officialUrl,
    "https://live-contract.example/product?source=lobsters",
  );
  assert.equal(
    byTitle.get("Live Contract")?.discussionUrl,
    "https://lobste.rs/s/live123/live_contract",
  );
  assert.equal(
    byTitle.get("Fallback Discussion")?.officialUrl,
    "https://fallback-discussion.example/story?ref=lobsters",
  );
  assert.equal(
    byTitle.get("Fallback Discussion")?.discussionUrl,
    "https://lobste.rs/s/fallback2/fallback_discussion",
  );
});

test("excludes Lobsters announce items when both primary URLs are internal and only description has an external href", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      lobstersAnnounce: lobstersFeed([
        {
          title: "Fourteener Lobsters",
          officialUrl: "https://lobste.rs/s/fourteen123/fourteener_lobsters",
          commentsUrl: "https://lobste.rs/s/fourteen123/fourteener_lobsters",
          discussionUrl: "https://lobste.rs/s/fourteen123/fourteener_lobsters",
          descriptionHref: "https://fourteener.example/post?source=announce&utm_source=rss",
          author: "rss",
          iso: daysAgo(1),
          guid: "fourteener-lobsters",
          description: " Internal announce item with an arbitrary external description link.",
        },
      ]),
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.deepEqual(result.launches, []);
  assert.equal(result.failures.length, 0);
});

test("drops candidates outside lookback and malformed or private destinations", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [301, 302, 303],
      hnItems: {
        "301": hnItem({
          id: 301,
          title: "Too Old",
          url: "https://old.example/?utm_source=hn",
          by: "oldtimer",
          iso: daysAgo(30),
          score: 80,
        }),
        "302": hnItem({
          id: 302,
          title: "Future Ship",
          url: "https://future.example/?utm_source=hn",
          by: "future",
          iso: "2026-08-06T12:00:00.000Z",
          score: 90,
        }),
        "303": hnItem({
          id: 303,
          title: "Private Ship",
          url: "http://127.0.0.1:4000/secret",
          by: "local",
          iso: daysAgo(1),
          score: 90,
        }),
      },
      devArticles: [
        devArticle({
          id: 401,
          title: "Show DEV: Valid Launch",
          officialUrl: "https://valid.example/path?utm_medium=dev&b=2&a=1",
          author: "valid",
          iso: daysAgo(1),
          description: "Valid public launch.",
          reactions: 11,
          comments: 2,
        }),
      ],
      hfSpaces: [
        hfSpace({
          id: "demo/private-space",
          title: "Private Space",
          author: "demo",
          iso: daysAgo(1),
          likes: 50,
          trendingScore: 99,
          privateSpace: true,
        }),
      ],
      lobstersAnnounce: lobstersFeed([
        {
          title: "Malformed Destination",
          discussionUrl: "https://lobste.rs/s/malformed123/malformed_destination",
          officialUrl: "javascript:alert('xss')",
          author: "rss",
          iso: daysAgo(2),
          guid: "lobsters-malformed",
        },
      ]),
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.equal(result.failures.length, 0);
  assert.deepEqual(
    result.launches.map((launch: Launch) => launch.title),
    ["Show DEV: Valid Launch"],
  );
  assert.equal(result.launches[0].officialUrl, "https://valid.example/path?a=1&b=2");
});

test("keeps discussion-only launches when HN, DEV, and Lobsters omit official URLs", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [1301],
      hnItems: {
        "1301": hnItem({
          id: 1301,
          title: "Ask HN: Ship Without Site",
          by: "hnmaker",
          iso: daysAgo(1),
          score: 44,
          text: "Public launch discussion without a separate product URL yet.",
        }),
      },
      devArticles: [
        devArticle({
          id: 1302,
          title: "Show DEV: Discussion Only Launch",
          officialUrl: null,
          discussionUrl: "https://dev.to/devrel/discussion-only-launch-1302",
          author: "devrel",
          iso: daysAgo(2),
          description: "Launch details are only in the DEV discussion for now.",
          reactions: 12,
          comments: 3,
        }),
      ],
      lobstersShow: lobstersFeed([
        {
          title: "Lobsters Discussion Launch",
          discussionUrl: "https://lobste.rs/s/discuss1303/discussion_only_launch",
          author: "lobster",
          iso: daysAgo(3),
          guid: "lobsters-discussion-only",
          description: "Discussion-only launch thread.",
          commentsUrl: "https://lobste.rs/s/discuss1303/discussion_only_launch",
        },
      ]),
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.equal(result.failures.length, 0);
  assert.deepEqual(
    result.launches.map((launch: Launch) => [launch.provider, launch.title, launch.officialUrl]),
    [
      ["hn", "Ask HN: Ship Without Site", null],
      ["dev", "Show DEV: Discussion Only Launch", null],
      ["lobsters", "Lobsters Discussion Launch", null],
    ],
  );
  assert.deepEqual(
    result.launches.map((launch: Launch) => launch.discussionUrl),
    [
      "https://news.ycombinator.com/item?id=1301",
      "https://dev.to/devrel/discussion-only-launch-1302",
      "https://lobste.rs/s/discuss1303/discussion_only_launch",
    ],
  );
});

test("retains semantic ref source and src params while removing analytics params", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [1501],
      hnItems: {
        "1501": hnItem({
          id: 1501,
          title: "Source Params",
          url: "https://source-params.example/?source=hn&src=card&ref=launch&utm_source=hn&fbclid=123",
          by: "param",
          iso: daysAgo(1),
          score: 20,
        }),
      },
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.equal(result.launches.length, 1);
  assert.equal(
    result.launches[0].officialUrl,
    "https://source-params.example/?ref=launch&source=hn&src=card",
  );
});

test("merges one launch found by multiple providers and retains provenance", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [501],
      hnItems: {
        "501": hnItem({
          id: 501,
          title: "Merged Launch",
          url: "https://merge.example/app?utm_source=hn&b=2&a=1#story",
          by: "alice",
          iso: daysAgo(1),
          score: 60,
        }),
      },
      devArticles: [
        devArticle({
          id: 601,
          title: "Show DEV: Merged Launch",
          officialUrl: "https://merge.example/app?b=2&utm_campaign=dev&a=1",
          discussionUrl: "https://dev.to/merge/showdev-merged-launch-601",
          author: "merge",
          iso: daysAgo(2),
          description: "Merged launch description from DEV.",
          reactions: 37,
          comments: 5,
        }),
      ],
      lobstersShow: lobstersFeed([
        {
          title: "Merged Launch on Lobsters",
          discussionUrl: "https://lobste.rs/s/merge123/merged_launch",
          officialUrl: "https://merge.example/app?a=1&b=2&utm_medium=rss",
          author: "rss",
          iso: daysAgo(3),
          guid: "merge-lobsters",
          description: " Same product, different discussion.",
        },
      ]),
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.launches.length, 1);

  const [launch] = result.launches;
  assert.equal(launch.officialUrl, "https://merge.example/app?a=1&b=2");
  assert.equal(launch.rankEvidence.corroborationCount, 3);
  assert.deepEqual(
    launch.providerUrls.map((entry) => entry.provider).sort(),
    ["dev", "hn", "lobsters"],
  );
  assert.deepEqual(
    launch.providerPayloads.map((entry) => entry.provider).sort(),
    ["dev", "hn", "lobsters"],
  );
});

test("ranks stably, caps each provider at two when alternatives exist, and returns five", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [701, 702, 703],
      hnItems: {
        "701": hnItem({
          id: 701,
          title: "Alpha Index",
          url: "https://alpha-rank.example/?utm_source=hn",
          by: "ranker",
          iso: daysAgo(1, 15),
          score: 120,
        }),
        "702": hnItem({
          id: 702,
          title: "Beta Index",
          url: "https://beta-rank.example/?utm_source=hn",
          by: "ranker",
          iso: daysAgo(1, 14),
          score: 100,
        }),
        "703": hnItem({
          id: 703,
          title: "Gamma Index",
          url: "https://gamma-rank.example/?utm_source=hn",
          by: "ranker",
          iso: daysAgo(1, 13),
          score: 90,
        }),
      },
      devArticles: [
        devArticle({
          id: 801,
          title: "Delta Index",
          officialUrl: "https://delta-rank.example/?utm_medium=dev",
          author: "delta",
          iso: daysAgo(2),
          description: "Delta launch.",
          reactions: 12,
          comments: 3,
        }),
      ],
      hfSpaces: [
        hfSpace({
          id: "rank/echo-space",
          title: "Echo Space",
          author: "rank",
          iso: daysAgo(2),
          likes: 8,
          trendingScore: 15,
          tags: ["rank"],
        }),
      ],
      lobstersAnnounce: lobstersFeed([
        {
          title: "Foxtrot Launch",
          discussionUrl: "https://lobste.rs/s/foxtrot123/foxtrot_launch",
          officialUrl: "https://zulu-rank.example/?utm_source=lobsters",
          author: "lob",
          iso: daysAgo(2),
          guid: "foxtrot-rank",
        },
      ]),
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
    limit: 9,
  });

  assert.equal(result.failures.length, 0);
  assert.equal(result.launches.length, 5);
  assert.deepEqual(
    result.launches.map((launch: Launch) => launch.title),
    [
      "Alpha Index",
      "Beta Index",
      "Delta Index",
      "Echo Space",
      "Foxtrot Launch",
    ],
  );
  assert.equal(
    result.launches.filter((launch: Launch) => launch.provider === "hn").length,
    2,
  );
});

test("breaks equal-score ties by normalized URL and then provider item ID when URL is unavailable", async () => {
  const equalScoreResult = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [1203, 1201, 1202],
      hnItems: {
        "1203": hnItem({
          id: 1203,
          title: "Zulu Tie",
          url: "https://zulu-tie.example/?utm_source=hn&b=2#a",
          by: "ranker",
          iso: daysAgo(1, 10),
          score: 50,
        }),
        "1201": hnItem({
          id: 1201,
          title: "Alpha Tie",
          url: "https://alpha-tie.example/?utm_source=hn&a=1#b",
          by: "ranker",
          iso: daysAgo(1, 10),
          score: 50,
        }),
        "1202": hnItem({
          id: 1202,
          title: "Mike Tie",
          url: "https://mike-tie.example/?utm_medium=social&c=3#c",
          by: "ranker",
          iso: daysAgo(1, 10),
          score: 50,
        }),
      },
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
    limit: 3,
  });

  assert.deepEqual(
    equalScoreResult.launches.map((launch: Launch) => ({
      title: launch.title,
      officialUrl: launch.officialUrl,
      score: launch.rankEvidence.score,
      freshness: launch.rankEvidence.freshnessScore,
      corroboration: launch.rankEvidence.corroborationCount,
    })),
    [
      {
        title: "Alpha Tie",
        officialUrl: "https://alpha-tie.example/?a=1",
        score: equalScoreResult.launches[0].rankEvidence.score,
        freshness: equalScoreResult.launches[0].rankEvidence.freshnessScore,
        corroboration: 1,
      },
      {
        title: "Mike Tie",
        officialUrl: "https://mike-tie.example/?c=3",
        score: equalScoreResult.launches[0].rankEvidence.score,
        freshness: equalScoreResult.launches[0].rankEvidence.freshnessScore,
        corroboration: 1,
      },
      {
        title: "Zulu Tie",
        officialUrl: "https://zulu-tie.example/?b=2",
        score: equalScoreResult.launches[0].rankEvidence.score,
        freshness: equalScoreResult.launches[0].rankEvidence.freshnessScore,
        corroboration: 1,
      },
    ],
  );
  assert.equal(equalScoreResult.launches[0].rankEvidence.score, equalScoreResult.launches[1].rankEvidence.score);
  assert.equal(equalScoreResult.launches[1].rankEvidence.score, equalScoreResult.launches[2].rankEvidence.score);
  assert.equal(
    equalScoreResult.launches[0].rankEvidence.freshnessScore,
    equalScoreResult.launches[1].rankEvidence.freshnessScore,
  );
  assert.equal(
    equalScoreResult.launches[1].rankEvidence.freshnessScore,
    equalScoreResult.launches[2].rankEvidence.freshnessScore,
  );

  const rankCandidatesForTest = await loadRankCandidatesForTest();
  const unavailableUrlCandidates: Array<Omit<Launch, "discussionUrl"> & { discussionUrl?: string }> = [
    {
      provider: "hn",
      providerItemId: "b-item",
      title: "Provider Item B",
      description: "",
      discussionUrl: undefined,
      officialUrl: null,
      author: "ranker",
      publishedAt: daysAgo(1, 10),
      engagement: 50,
      tags: [],
      providerUrls: [{ provider: "hn", url: "https://news.ycombinator.com/item?id=9992" }],
      providerPayloads: [{ provider: "hn", payload: { id: "b-item" } }],
      dedupKey: "hn:b-item",
      rankEvidence: {
        engagementPercentile: 0,
        freshnessScore: 0,
        corroborationCount: 1,
        score: 0,
        tieBreakKey: "",
      },
    },
    {
      provider: "hn",
      providerItemId: "a-item",
      title: "Provider Item A",
      description: "",
      discussionUrl: undefined,
      officialUrl: null,
      author: "ranker",
      publishedAt: daysAgo(1, 10),
      engagement: 50,
      tags: [],
      providerUrls: [{ provider: "hn", url: "https://news.ycombinator.com/item?id=9991" }],
      providerPayloads: [{ provider: "hn", payload: { id: "a-item" } }],
      dedupKey: "hn:a-item",
      rankEvidence: {
        engagementPercentile: 0,
        freshnessScore: 0,
        corroborationCount: 1,
        score: 0,
        tieBreakKey: "",
      },
    },
  ];

  assert.deepEqual(
    rankCandidatesForTest(unavailableUrlCandidates, {
      now: NOW,
      lookbackDays: LOOKBACK_DAYS,
    }).map((launch: Launch) => launch.providerItemId),
    ["a-item", "b-item"],
  );
});

test("continues after partial provider failure", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: new Response("upstream error", { status: 503 }),
      devArticles: [
        devArticle({
          id: 901,
          title: "Show DEV: Survives Partial Failure",
          officialUrl: "https://partial.example/?utm_source=dev",
          author: "partial",
          iso: daysAgo(1),
          description: "Still eligible.",
          reactions: 7,
          comments: 1,
        }),
      ],
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.deepEqual(
    result.launches.map((launch: Launch) => launch.title),
    ["Show DEV: Survives Partial Failure"],
  );
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].provider, "hn");
  assert.equal(result.failures[0].category, "http");
  assert.match(result.failures[0].reason, /503/);
});

test("keeps successful HN stories when one item request fails", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [1801, 1802],
      hnItems: {
        "1801": hnItem({
          id: 1801,
          title: "HN Survives Item Failure",
          url: "https://hn-success.example/?utm_source=hn",
          by: "hn",
          iso: daysAgo(1),
          score: 42,
        }),
        "1802": new Error("item failed"),
      },
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.deepEqual(
    result.launches.map((launch: Launch) => launch.title),
    ["HN Survives Item Failure"],
  );
  assert.equal(result.failures.length, 0);
});

test("reports an HN provider failure when showstories ids exist but every item request fails", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [1901, 1902],
      hnItems: {
        "1901": new Error("item exploded"),
        "1902": new Error("item exploded"),
      },
      devArticles: [
        devArticle({
          id: 1903,
          title: "Show DEV: HN Failed But DEV Survived",
          officialUrl: "https://dev-survived.example/?utm_source=dev",
          author: "dev",
          iso: daysAgo(1),
          description: "DEV still succeeds.",
          reactions: 5,
          comments: 1,
        }),
      ],
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.deepEqual(
    result.launches.map((launch: Launch) => launch.title),
    ["Show DEV: HN Failed But DEV Survived"],
  );
  assert.deepEqual(result.failures, [
    {
      provider: "hn",
      category: "network",
      reason: "network_error",
    },
  ]);
});

test("preserves a homogeneous timeout aggregate when all HN item requests time out", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [1951, 1952],
      hnItems: {
        "1951": abortError("timeout 1"),
        "1952": abortError("timeout 2"),
      },
      devArticles: [
        devArticle({
          id: 1953,
          title: "Show DEV: Timeout Aggregate Survived",
          officialUrl: "https://timeout-aggregate.example/?utm_source=dev",
          author: "dev",
          iso: daysAgo(1),
          description: "DEV still succeeds.",
          reactions: 4,
          comments: 1,
        }),
      ],
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.deepEqual(result.failures, [
    {
      provider: "hn",
      category: "timeout",
      reason: "timeout",
    },
  ]);
});

test("preserves a homogeneous safe http aggregate when all HN item requests fail with the same status", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [1961, 1962],
      hnItems: {
        "1961": new Response("down", { status: 503 }),
        "1962": new Response("down", { status: 503 }),
      },
      devArticles: [
        devArticle({
          id: 1963,
          title: "Show DEV: HTTP Aggregate Survived",
          officialUrl: "https://http-aggregate.example/?utm_source=dev",
          author: "dev",
          iso: daysAgo(1),
          description: "DEV still succeeds.",
          reactions: 4,
          comments: 1,
        }),
      ],
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.deepEqual(result.failures, [
    {
      provider: "hn",
      category: "http",
      reason: "http_503",
    },
  ]);
});

test("preserves a homogeneous invalid_json aggregate when all HN item requests return malformed JSON", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [1971, 1972],
      hnItems: {
        "1971": new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
        "1972": new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      },
      devArticles: [
        devArticle({
          id: 1973,
          title: "Show DEV: JSON Aggregate Survived",
          officialUrl: "https://json-aggregate.example/?utm_source=dev",
          author: "dev",
          iso: daysAgo(1),
          description: "DEV still succeeds.",
          reactions: 4,
          comments: 1,
        }),
      ],
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.deepEqual(result.failures, [
    {
      provider: "hn",
      category: "parse",
      reason: "invalid_json",
    },
  ]);
});

test("falls back to network_error when all HN item failures are mixed", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [1981, 1982],
      hnItems: {
        "1981": abortError("timeout"),
        "1982": new Response("down", { status: 503 }),
      },
      devArticles: [
        devArticle({
          id: 1983,
          title: "Show DEV: Mixed Aggregate Survived",
          officialUrl: "https://mixed-aggregate.example/?utm_source=dev",
          author: "dev",
          iso: daysAgo(1),
          description: "DEV still succeeds.",
          reactions: 4,
          comments: 1,
        }),
      ],
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.deepEqual(result.failures, [
    {
      provider: "hn",
      category: "network",
      reason: "network_error",
    },
  ]);
});

test("throws a typed discovery error only when all providers fail", async () => {
  await assert.rejects(
    () =>
      discoverNewProductLaunches({
        fetcher: createFixtureFetcher({
          hnStories: [2001, 2002],
          hnItems: {
            "2001": abortError("timeout"),
            "2002": abortError("timeout"),
          },
          devArticles: new Error("socket hang up"),
          hfSpaces: new Response("{", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
          lobstersShow: new Error("rss unavailable"),
          lobstersAnnounce: new Error("rss unavailable"),
        }),
        now: NOW,
        lookbackDays: LOOKBACK_DAYS,
      }),
    (error: unknown) => {
      assert.ok(error instanceof NewProductLaunchDiscoveryError);
      const discoveryError = error as NewProductLaunchDiscoveryError;
      assert.equal(discoveryError.name, "NewProductLaunchDiscoveryError");
      assert.equal(discoveryError.failures.length, 4);
      assert.deepEqual(
        discoveryError.failures
          .map((failure: DiscoveryFailure) => [failure.provider, failure.reason])
          .sort((left, right) => left[0].localeCompare(right[0])),
        [
          ["dev", "network_error"],
          ["hn", "timeout"],
          ["huggingface", "invalid_json"],
          ["lobsters", "network_error"],
        ],
      );
      return true;
    },
  );
});

test("returns an empty successful result when providers succeed with no eligible launch", async () => {
  const result = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: [1001],
      hnItems: {
        "1001": hnItem({
          id: 1001,
          title: "Future Only",
          url: "https://future-only.example/?utm_source=hn",
          by: "future",
          iso: "2026-08-10T12:00:00.000Z",
          score: 99,
        }),
      },
      devArticles: [
        devArticle({
          id: 1002,
          title: "Show DEV: Localhost Only",
          officialUrl: "http://localhost:3000/private",
          author: "devonly",
          iso: daysAgo(1),
          description: "Not public.",
          reactions: 9,
          comments: 2,
        }),
      ],
      hfSpaces: [
        hfSpace({
          id: "empty/private-space",
          title: "Hidden Space",
          author: "empty",
          iso: daysAgo(1),
          likes: 10,
          trendingScore: 10,
          privateSpace: true,
        }),
      ],
      lobstersAnnounce: lobstersFeed([
        {
          title: "Malformed Link Only",
          discussionUrl: "https://lobste.rs/s/empty123/malformed_link_only",
          officialUrl: "notaurl",
          author: "empty",
          iso: daysAgo(1),
          guid: "empty-malformed",
        },
      ]),
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.equal(result.failures.length, 0);
  assert.deepEqual(result.launches, []);
});

test("failure records use allowlisted reasons and never leak secret-looking error text", async () => {
  const secretText =
    "Authorization: Bearer top-secret api-key=abc123 response body={\"token\":\"shh\"}";

  const partialResult = await discoverNewProductLaunches({
    fetcher: createFixtureFetcher({
      hnStories: new Error(secretText),
      devArticles: [
        devArticle({
          id: 1101,
          title: "Show DEV: Safe Launch",
          officialUrl: "https://safe.example/product?utm_source=dev",
          author: "safe",
          iso: daysAgo(1),
          description: "Still succeeds.",
          reactions: 8,
          comments: 1,
        }),
      ],
    }),
    now: NOW,
    lookbackDays: LOOKBACK_DAYS,
  });

  assert.equal(partialResult.failures.length, 1);
  assert.deepEqual(partialResult.failures[0], {
    provider: "hn",
    category: "network",
    reason: "network_error",
  });
  assert.doesNotMatch(JSON.stringify(partialResult.failures), /bearer|api-key|body|token|abc123/i);

  await assert.rejects(
    () =>
      discoverNewProductLaunches({
        fetcher: createFixtureFetcher({
          hnStories: new Error(secretText),
          devArticles: new Error(secretText),
          hfSpaces: new Error(secretText),
          lobstersShow: new Error(secretText),
          lobstersAnnounce: new Error(secretText),
        }),
        now: NOW,
        lookbackDays: LOOKBACK_DAYS,
      }),
    (error: unknown) => {
      assert.ok(error instanceof NewProductLaunchDiscoveryError);
      const discoveryError = error as NewProductLaunchDiscoveryError;
      assert.deepEqual(
        discoveryError.failures.map((failure: DiscoveryFailure) => failure.reason).sort(),
        ["network_error", "network_error", "network_error", "network_error"],
      );
      assert.doesNotMatch(
        JSON.stringify(discoveryError.failures),
        /bearer|api-key|body|token|abc123/i,
      );
      return true;
    },
  );
});

test("rejects bracketed IPv6 loopback, private, link-local, and unspecified hostnames", () => {
  assert.equal(isPrivateHostnameForTest("[::1]"), true);
  assert.equal(isPrivateHostnameForTest("[::]"), true);
  assert.equal(isPrivateHostnameForTest("[fc00::1]"), true);
  assert.equal(isPrivateHostnameForTest("[fd00::1]"), true);
  assert.equal(isPrivateHostnameForTest("[fe80::1]"), true);
  assert.equal(isPrivateHostnameForTest("[::ffff:127.0.0.1]"), true);
  assert.equal(isPrivateHostnameForTest("[::ffff:10.0.0.8]"), true);
  assert.equal(isPrivateHostnameForTest("[::ffff:192.168.1.10]"), true);
  assert.equal(isPrivateHostnameForTest("[2607:f8b0:4005:805::200e]"), false);
});

test("rejects reserved and non-global IPv4 ranges", () => {
  const cases = [
    ["10.0.0.1", true],
    ["100.64.0.1", true],
    ["100.127.255.254", true],
    ["127.0.0.1", true],
    ["169.254.1.1", true],
    ["172.16.0.1", true],
    ["192.0.0.1", true],
    ["192.0.2.1", true],
    ["192.88.99.1", true],
    ["192.168.1.1", true],
    ["198.18.0.1", true],
    ["198.19.255.1", true],
    ["198.51.100.5", true],
    ["203.0.113.9", true],
    ["224.0.0.1", true],
    ["240.0.0.1", true],
    ["255.255.255.255", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
  ] as const;

  for (const [hostname, expected] of cases) {
    assert.equal(
      isPrivateHostnameForTest(hostname),
      expected,
      `${hostname} expected private=${expected}`,
    );
  }
});

test("rejects *.localhost and non-global IPv6 ranges while allowing global unicast", () => {
  const cases = [
    ["api.localhost", true],
    ["dev.api.localhost", true],
    ["[::1]", true],
    ["[::]", true],
    ["[fe80::1]", true],
    ["[fc00::1]", true],
    ["[fd00::1]", true],
    ["[fec0::1]", true],
    ["[ff02::1]", true],
    ["[100::1]", true],
    ["[2001:db8::1]", true],
    ["[2607:f8b0:4005:805::200e]", false],
    ["[2001:4860:4860::8888]", false],
  ] as const;

  for (const [hostname, expected] of cases) {
    assert.equal(
      isPrivateHostnameForTest(hostname),
      expected,
      `${hostname} expected private=${expected}`,
    );
  }
});
