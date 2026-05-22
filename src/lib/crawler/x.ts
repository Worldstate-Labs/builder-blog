import { FeedItemKind } from "@prisma/client";
import type { CrawlerBuilder, CrawlOptions, CrawlSourceResult } from "./types";
import { asErrorMessage } from "./types";

const X_API_BASE = "https://api.x.com/2";
const TWEET_LOOKBACK_HOURS = 24;
const MAX_TWEETS_PER_USER = 3;

type XUser = {
  id: string;
  name: string;
  username: string;
  description?: string;
};

type XTweet = {
  id: string;
  text: string;
  created_at?: string;
  note_tweet?: { text?: string };
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
  };
  referenced_tweets?: Array<{ type: string; id: string }>;
};

export async function crawlXBuilders(
  builders: CrawlerBuilder[],
  options: CrawlOptions & { bearerToken?: string | null } = {},
): Promise<CrawlSourceResult> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const errors: string[] = [];
  const items: CrawlSourceResult["items"] = [];
  const builderUpdates: CrawlSourceResult["builderUpdates"] = [];
  const accounts = builders.filter((builder) => builder.handle);

  if (accounts.length === 0) {
    return { source: "x", builders: 0, items, errors };
  }
  if (!options.bearerToken) {
    return {
      source: "x",
      builders: accounts.length,
      items,
      errors: ["X API: X_BEARER_TOKEN is not configured"],
    };
  }

  const userByHandle = new Map<string, XUser>();
  for (let index = 0; index < accounts.length; index += 100) {
    const batch = accounts.slice(index, index + 100);
    const usernames = batch.map((builder) => builder.handle).filter(Boolean).join(",");
    try {
      const params = new URLSearchParams({
        usernames,
        "user.fields": "name,description",
      });
      const response = await fetcher(`${X_API_BASE}/users/by?${params.toString()}`, {
        headers: { Authorization: `Bearer ${options.bearerToken}` },
      });
      if (!response.ok) {
        errors.push(`X API: User lookup failed: HTTP ${response.status}`);
        continue;
      }
      const data = (await response.json()) as {
        data?: XUser[];
        errors?: Array<{ value?: string; detail?: string }>;
      };
      for (const user of data.data ?? []) {
        userByHandle.set(user.username.toLowerCase(), user);
      }
      for (const error of data.errors ?? []) {
        errors.push(`X API: User not found: ${error.value ?? error.detail ?? "unknown"}`);
      }
    } catch (error) {
      errors.push(`X API: User lookup error: ${asErrorMessage(error)}`);
    }
  }

  const cutoff = new Date(now.getTime() - TWEET_LOOKBACK_HOURS * 60 * 60 * 1000);
  for (const builder of accounts) {
    const handle = builder.handle?.toLowerCase();
    const user = handle ? userByHandle.get(handle) : null;
    if (!handle || !user) continue;

    if (user.description && user.description !== builder.bio) {
      builderUpdates?.push({ id: builder.id, bio: user.description });
    }

    try {
      const params = new URLSearchParams({
        max_results: "5",
        "tweet.fields": "created_at,public_metrics,referenced_tweets,note_tweet",
        exclude: "retweets,replies",
        start_time: cutoff.toISOString(),
      });
      const response = await fetcher(`${X_API_BASE}/users/${user.id}/tweets?${params.toString()}`, {
        headers: { Authorization: `Bearer ${options.bearerToken}` },
      });
      if (!response.ok) {
        if (response.status === 429) {
          errors.push("X API: Rate limited, skipping remaining accounts");
          break;
        }
        errors.push(`X API: Failed to fetch tweets for @${handle}: HTTP ${response.status}`);
        continue;
      }

      const data = (await response.json()) as { data?: XTweet[] };
      for (const tweet of (data.data ?? []).slice(0, MAX_TWEETS_PER_USER)) {
        const body = tweet.note_tweet?.text || tweet.text;
        items.push({
          builderId: builder.id,
          kind: FeedItemKind.TWEET,
          externalId: tweet.id,
          body,
          url: `https://x.com/${handle}/status/${tweet.id}`,
          publishedAt: tweet.created_at ? new Date(tweet.created_at) : null,
          sourceName: builder.name,
          rawJson: {
            id: tweet.id,
            text: body,
            createdAt: tweet.created_at,
            url: `https://x.com/${handle}/status/${tweet.id}`,
            likes: tweet.public_metrics?.like_count ?? 0,
            retweets: tweet.public_metrics?.retweet_count ?? 0,
            replies: tweet.public_metrics?.reply_count ?? 0,
            isQuote: tweet.referenced_tweets?.some((ref) => ref.type === "quoted") ?? false,
            quotedTweetId:
              tweet.referenced_tweets?.find((ref) => ref.type === "quoted")?.id ?? null,
          },
        });
      }
    } catch (error) {
      errors.push(`X API: Error fetching @${handle}: ${asErrorMessage(error)}`);
    }
  }

  return { source: "x", builders: accounts.length, items, errors, builderUpdates };
}
