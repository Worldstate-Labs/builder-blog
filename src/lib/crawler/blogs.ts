import { FeedItemKind } from "@prisma/client";
import type { CrawlerBuilder, CrawlOptions, CrawlSourceResult } from "./types";
import { asErrorMessage, stripHtml } from "./types";

const BLOG_LOOKBACK_HOURS = 72;
const MAX_ARTICLES_PER_BLOG = 3;

type ArticleCandidate = {
  title: string;
  url: string;
  publishedAt: string | null;
  description: string;
};

type ExtractedArticle = {
  title: string;
  author: string;
  publishedAt: string | null;
  content: string;
};

export async function crawlBlogBuilders(
  builders: CrawlerBuilder[],
  options: CrawlOptions = {},
): Promise<CrawlSourceResult> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const errors: string[] = [];
  const items: CrawlSourceResult["items"] = [];
  const cutoff = new Date(now.getTime() - BLOG_LOOKBACK_HOURS * 60 * 60 * 1000);

  for (const builder of builders) {
    const indexUrl = builder.crawlUrl ?? builder.sourceUrl;
    if (!indexUrl) {
      errors.push(`Blog: No index URL configured for ${builder.name}`);
      continue;
    }
    try {
      const indexResponse = await fetcher(indexUrl, {
        headers: { "User-Agent": "BuilderBlog/1.0 (feed aggregator)" },
      });
      if (!indexResponse.ok) {
        errors.push(`Blog: Failed to fetch index for ${builder.name}: HTTP ${indexResponse.status}`);
        continue;
      }
      const candidates = parseBlogIndex(await indexResponse.text(), indexUrl)
        .slice(0, MAX_ARTICLES_PER_BLOG)
        .filter((article) => !article.publishedAt || new Date(article.publishedAt) >= cutoff);

      for (const article of candidates) {
        try {
          const articleResponse = await fetcher(article.url, {
            headers: { "User-Agent": "BuilderBlog/1.0 (feed aggregator)" },
          });
          if (!articleResponse.ok) {
            errors.push(`Blog: Failed to fetch article ${article.url}: HTTP ${articleResponse.status}`);
            continue;
          }
          const extracted = extractArticleContent(await articleResponse.text(), article.url);
          if (!extracted.content) {
            errors.push(`Blog: No content extracted from ${article.url}`);
            continue;
          }
          items.push({
            builderId: builder.id,
            kind: FeedItemKind.BLOG_POST,
            externalId: article.url,
            title: extracted.title || article.title || "Untitled",
            body: extracted.content,
            url: article.url,
            publishedAt: dateOrNull(extracted.publishedAt || article.publishedAt),
            sourceName: builder.name,
            rawJson: {
              source: "blog",
              name: builder.name,
              title: extracted.title || article.title || "Untitled",
              url: article.url,
              publishedAt: extracted.publishedAt || article.publishedAt,
              author: extracted.author,
              description: article.description,
              content: extracted.content,
            },
          });
        } catch (error) {
          errors.push(`Blog: Error fetching article ${article.url}: ${asErrorMessage(error)}`);
        }
      }
    } catch (error) {
      errors.push(`Blog: Error processing ${builder.name}: ${asErrorMessage(error)}`);
    }
  }

  return { source: "blogs", builders: builders.length, items, errors };
}

export function parseBlogIndex(html: string, indexUrl: string): ArticleCandidate[] {
  if (indexUrl.includes("anthropic.com")) return parseAnthropicEngineeringIndex(html);
  if (indexUrl.includes("claude.com")) return parseClaudeBlogIndex(html);
  return parseGenericBlogIndex(html, indexUrl);
}

function parseAnthropicEngineeringIndex(html: string): ArticleCandidate[] {
  const articles: ArticleCandidate[] = [];
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const posts = data?.props?.pageProps?.posts ?? data?.props?.pageProps?.articles ?? [];
      for (const post of posts) {
        const slug = post.slug?.current || post.slug || "";
        if (!slug) continue;
        articles.push({
          title: post.title || "Untitled",
          url: `https://www.anthropic.com/engineering/${slug}`,
          publishedAt: post.publishedOn || post.publishedAt || post.date || null,
          description: post.summary || post.description || "",
        });
      }
      if (articles.length > 0) return dedupeArticles(articles);
    } catch {
      // Fall back to rendered links.
    }
  }
  return linksByPattern(html, /href="\/engineering\/([a-z0-9-]+)"/gi, "https://www.anthropic.com/engineering/");
}

function parseClaudeBlogIndex(html: string): ArticleCandidate[] {
  return linksByPattern(html, /href="\/blog\/([a-z0-9-]+)"/gi, "https://claude.com/blog/");
}

function parseGenericBlogIndex(html: string, indexUrl: string): ArticleCandidate[] {
  const base = new URL(indexUrl);
  const articles: ArticleCandidate[] = [];
  const linkRegex = /href="([^"#?]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = new URL(match[1], base);
    if (url.origin !== base.origin) continue;
    if (url.href === base.href) continue;
    articles.push({ title: "", url: url.href, publishedAt: null, description: "" });
  }
  return dedupeArticles(articles);
}

function linksByPattern(html: string, pattern: RegExp, prefix: string) {
  const articles: ArticleCandidate[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    articles.push({
      title: "",
      url: `${prefix}${match[1]}`,
      publishedAt: null,
      description: "",
    });
  }
  return dedupeArticles(articles);
}

function dedupeArticles(articles: ArticleCandidate[]) {
  const seen = new Set<string>();
  return articles.filter((article) => {
    if (seen.has(article.url)) return false;
    seen.add(article.url);
    return true;
  });
}

export function extractArticleContent(html: string, articleUrl: string): ExtractedArticle {
  if (articleUrl.includes("anthropic.com/engineering")) {
    return extractAnthropicArticleContent(html);
  }
  if (articleUrl.includes("claude.com/blog")) {
    return extractClaudeBlogArticleContent(html);
  }
  return extractGenericArticleContent(html);
}

function extractAnthropicArticleContent(html: string): ExtractedArticle {
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const pageProps = data?.props?.pageProps;
      const post = pageProps?.post ?? pageProps?.article ?? pageProps?.entry ?? pageProps;
      const textParts: string[] = [];
      for (const block of post?.body ?? post?.content ?? []) {
        if (block?._type === "block" && Array.isArray(block.children)) {
          const text = block.children.map((child: { text?: string }) => child.text ?? "").join("");
          if (text.trim()) textParts.push(text.trim());
        }
      }
      if (textParts.length > 0) {
        return {
          title: post?.title || "",
          author: post?.author?.name || post?.authors?.[0]?.name || "",
          publishedAt: post?.publishedOn || post?.publishedAt || post?.date || null,
          content: textParts.join("\n\n"),
        };
      }
    } catch {
      // Fall back to HTML extraction.
    }
  }
  return extractGenericArticleContent(html);
}

function extractClaudeBlogArticleContent(html: string): ExtractedArticle {
  let title = "";
  let author = "";
  let publishedAt: string | null = null;
  const jsonLdRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1]);
      if (json["@type"] === "BlogPosting" || json["@type"] === "Article") {
        title = json.headline || json.name || "";
        author = json.author?.name || "";
        publishedAt = json.datePublished || null;
        break;
      }
    } catch {
      // Skip invalid JSON-LD.
    }
  }
  const richTextMatch =
    html.match(/<div[^>]*class="[^"]*u-rich-text-blog[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
    html.match(/<div[^>]*class="[^"]*w-richtext[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const content = richTextMatch ? stripHtml(richTextMatch[1]) : stripHtml(html);
  return {
    title: title || titleFromH1(html),
    author,
    publishedAt,
    content,
  };
}

function extractGenericArticleContent(html: string): ExtractedArticle {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  return {
    title: titleFromH1(html),
    author: "",
    publishedAt: null,
    content: stripHtml(articleMatch ? articleMatch[1] : html),
  };
}

function titleFromH1(html: string) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? stripHtml(match[1]) : "";
}

function dateOrNull(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
