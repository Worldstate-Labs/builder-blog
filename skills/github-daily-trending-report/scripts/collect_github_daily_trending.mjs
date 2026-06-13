#!/usr/bin/env node

import fs from "node:fs";

const args = process.argv.slice(2);

function readFlag(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

const top = Number.parseInt(readFlag("--top", "5"), 10);
const since = readFlag("--since", "daily");
const output = readFlag("--output", "");

if (!Number.isFinite(top) || top < 1) {
  throw new Error("--top must be a positive integer");
}

const userAgent = "github-daily-trending-report-skill";

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function gh(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${path} failed: ${response.status} ${body}`);
  }
  return response.json();
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function parseTrending(html) {
  const articles = html.match(/<article class="Box-row"[\s\S]*?<\/article>/g) || [];
  return articles
    .map((article) => {
      const repoMatch = article.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"[^>]*>/);
      if (!repoMatch) return null;

      const descMatch = article.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
      const starsMatch = article.match(/([\d,]+)\s+stars\s+today/);
      const languageMatch = article.match(/<span itemprop="programmingLanguage">([^<]+)<\/span>/);

      return {
        repo: repoMatch[1].trim(),
        url: `https://github.com/${repoMatch[1].trim()}`,
        trendingDescription: descMatch ? stripTags(descMatch[1]) : "",
        starsToday: starsMatch ? Number.parseInt(starsMatch[1].replaceAll(",", ""), 10) : 0,
        trendingLanguage: languageMatch ? decodeHtml(languageMatch[1].trim()) : "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.starsToday - a.starsToday);
}

async function fetchReadme(repo, branch) {
  for (const name of ["README.md", "readme.md", "README.rst"]) {
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/${name}`;
    const response = await fetch(url, { headers: { "User-Agent": userAgent } });
    if (response.ok) {
      return {
        path: name,
        url,
        text: await response.text(),
      };
    }
  }
  return { path: "", url: "", text: "" };
}

async function enrich(candidate) {
  const meta = await gh(`/repos/${candidate.repo}`);
  const readme = await fetchReadme(candidate.repo, meta.default_branch);

  let tree = [];
  try {
    const treeResponse = await gh(`/repos/${candidate.repo}/git/trees/${meta.default_branch}?recursive=1`);
    tree = (treeResponse.tree || []).filter((entry) => entry.type === "blob").map((entry) => entry.path);
  } catch {
    tree = [];
  }

  let releases = [];
  try {
    releases = (await gh(`/repos/${candidate.repo}/releases?per_page=5`)).map((release) => ({
      tag: release.tag_name,
      name: release.name,
      publishedAt: release.published_at,
      url: release.html_url,
      bodyPreview: (release.body || "").slice(0, 1800),
    }));
  } catch {
    releases = [];
  }

  let commits = [];
  try {
    commits = (await gh(`/repos/${candidate.repo}/commits?per_page=10`)).map((commit) => ({
      sha: commit.sha.slice(0, 7),
      date: commit.commit?.committer?.date,
      message: commit.commit?.message?.split("\n")[0] || "",
      url: commit.html_url,
    }));
  } catch {
    commits = [];
  }

  let root = [];
  try {
    root = (await gh(`/repos/${candidate.repo}/contents?ref=${meta.default_branch}`)).map((entry) => ({
      name: entry.name,
      type: entry.type,
      path: entry.path,
    }));
  } catch {
    root = [];
  }

  return {
    ...candidate,
    repoDescription: meta.description,
    totalStars: meta.stargazers_count,
    forks: meta.forks_count,
    openIssues: meta.open_issues_count,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
    pushedAt: meta.pushed_at,
    defaultBranch: meta.default_branch,
    topics: meta.topics || [],
    language: meta.language,
    license: meta.license?.spdx_id || "",
    homepage: meta.homepage || "",
    readme,
    root,
    tree,
    releases,
    commits,
  };
}

const trendingHtml = await fetchText(`https://github.com/trending?since=${encodeURIComponent(since)}`);
const candidates = parseTrending(trendingHtml).slice(0, top);
const enriched = [];

for (const candidate of candidates) {
  enriched.push(await enrich(candidate));
}

const payload = {
  collectedAt: new Date().toISOString(),
  since,
  source: `https://github.com/trending?since=${since}`,
  repositories: enriched,
};

const json = JSON.stringify(payload, null, 2);
if (output) {
  fs.writeFileSync(output, json);
  console.log(output);
} else {
  console.log(json);
}
