export type AiSourceReviewProposal = {
  name: string;
  sourceType: "blog" | "x";
  sourceUrl: string;
  fetchUrl?: string;
  handle?: string;
  avatarDomain?: string;
  avatarUrl?: string;
};

export type AiSourceAuditProposal = Omit<AiSourceReviewProposal, "sourceType"> & {
  sourceType: AiSourceReviewProposal["sourceType"] | "website";
};

export type AiSourceAuditHttpEvidence = {
  finalUrl: string | null;
  status: number | null;
};

export type AiSourceAuditResolverEvidence = {
  ok: boolean;
  finalUrl: string | null;
  status: number | null;
};

export type AiSourceAuditProbeEvidence = {
  ok: boolean;
  finalUrl: string | null;
  status: number | null;
  robotsDenied: boolean;
  loginRequired: boolean;
};

export type AiSourceAuditFetcherTaskEvidence = {
  type: string;
  recentDiscoveredContent: boolean;
};

export type AiSourceAuditFetchEvidence = {
  itemCount: number;
  recentItemCount: number;
  actionableTasks: readonly AiSourceAuditFetcherTaskEvidence[];
  hardFailure?: boolean;
  hardFailureDetail?: string | null;
};

export type AiSourceAuditTokenState = "accepted" | "missing" | "invalid" | "unknown";

export type AiSourceAuditXEvidence = {
  tokenState: AiSourceAuditTokenState;
  requestedHandle: string | null;
  resolvedHandle: string | null;
  exactHandleMatch: boolean;
};

export type AiSourceAuditIconEvidence = {
  url: string | null;
  safeUrl: boolean;
  downloaded: boolean;
};

export type AiSourceAuditInput = {
  proposal: AiSourceAuditProposal;
  http: AiSourceAuditHttpEvidence;
  resolver: AiSourceAuditResolverEvidence;
  probe: AiSourceAuditProbeEvidence;
  fetch: AiSourceAuditFetchEvidence;
  x: AiSourceAuditXEvidence;
  icon: AiSourceAuditIconEvidence;
};

export type AiSourceAuditRejectionReason =
  | "unsupported_source_type"
  | "resolver_failed"
  | "probe_failed"
  | "hard_fetch_failed"
  | "robots_denied"
  | "x_token_missing"
  | "x_token_invalid"
  | "x_handle_mismatch"
  | "no_recent_content"
  | "icon_unavailable";

export type AiSourceAuditResult = {
  proposal: AiSourceAuditProposal;
  http: AiSourceAuditHttpEvidence;
  resolver: AiSourceAuditResolverEvidence;
  probe: AiSourceAuditProbeEvidence;
  fetch: AiSourceAuditFetchEvidence & {
    actionableTaskCount: number;
    actionableTaskTypes: readonly string[];
  };
  x: AiSourceAuditXEvidence;
  icon: AiSourceAuditIconEvidence;
  accepted: boolean;
  reason: AiSourceAuditRejectionReason | null;
  detail: string;
};

function reject(
  input: AiSourceAuditInput,
  reason: AiSourceAuditRejectionReason,
  detail: string,
): AiSourceAuditResult {
  return {
    proposal: input.proposal,
    http: input.http,
    resolver: input.resolver,
    probe: input.probe,
    fetch: summarizeFetchEvidence(input.fetch),
    x: input.x,
    icon: input.icon,
    accepted: false,
    reason,
    detail,
  };
}

function summarizeFetchEvidence(fetch: AiSourceAuditFetchEvidence): AiSourceAuditResult["fetch"] {
  return {
    ...fetch,
    actionableTaskCount: fetch.actionableTasks.length,
    actionableTaskTypes: fetch.actionableTasks.map((task) => task.type),
  };
}

function accept(input: AiSourceAuditInput, detail: string): AiSourceAuditResult {
  return {
    proposal: input.proposal,
    http: input.http,
    resolver: input.resolver,
    probe: input.probe,
    fetch: summarizeFetchEvidence(input.fetch),
    x: input.x,
    icon: input.icon,
    accepted: true,
    reason: null,
    detail,
  };
}

function hasRecentBlogFallbackTask(fetch: AiSourceAuditFetchEvidence): boolean {
  return fetch.actionableTasks.some(
    (task) => task.type === "blog_article_fetch" && task.recentDiscoveredContent,
  );
}

function hasUsableIcon(icon: AiSourceAuditIconEvidence): boolean {
  return Boolean(icon.url) && icon.safeUrl && icon.downloaded;
}

export function evaluateAiSourceAudit(input: AiSourceAuditInput): AiSourceAuditResult {
  if (input.proposal.sourceType !== "blog" && input.proposal.sourceType !== "x") {
    return reject(
      input,
      "unsupported_source_type",
      `Unsupported source type "${input.proposal.sourceType}" is not eligible for AI source review.`,
    );
  }

  if (!input.resolver.ok) {
    return reject(
      input,
      "resolver_failed",
      `Source resolver did not succeed for "${input.proposal.name}".`,
    );
  }

  if (input.probe.loginRequired || (!input.probe.ok && !input.probe.robotsDenied)) {
    return reject(
      input,
      "probe_failed",
      `Source probe did not confirm a directly fetchable public source for "${input.proposal.name}".`,
    );
  }

  if (input.fetch.hardFailure) {
    return reject(
      input,
      "hard_fetch_failed",
      input.fetch.hardFailureDetail ||
        `Real content fetch failed for "${input.proposal.name}" before current content could be verified.`,
    );
  }

  if (input.probe.robotsDenied) {
    return reject(
      input,
      "robots_denied",
      `Source "${input.proposal.name}" disallows fetch access via robots or equivalent policy.`,
    );
  }

  if (input.proposal.sourceType === "x") {
    if (input.x.tokenState === "missing") {
      return reject(
        input,
        "x_token_missing",
        `X bearer token is missing for "${input.proposal.name}".`,
      );
    }
    if (input.x.tokenState === "invalid" || input.x.tokenState !== "accepted") {
      return reject(
        input,
        "x_token_invalid",
        `X bearer token was not positively accepted for "${input.proposal.name}".`,
      );
    }
    if (!input.x.exactHandleMatch) {
      return reject(
        input,
        "x_handle_mismatch",
        `Resolved X handle did not exactly match the requested handle for "${input.proposal.name}".`,
      );
    }
    if (input.fetch.recentItemCount < 1) {
      return reject(
        input,
        "no_recent_content",
        `Resolved X account "${input.proposal.name}" has no recent posts available to review.`,
      );
    }
  } else {
    if (input.fetch.recentItemCount < 1 && !hasRecentBlogFallbackTask(input.fetch)) {
      return reject(
        input,
        "no_recent_content",
        `Blog source "${input.proposal.name}" has no recent content items or actionable article fetch tasks to review.`,
      );
    }
  }

  if (!hasUsableIcon(input.icon)) {
    return reject(
      input,
      "icon_unavailable",
      `Source "${input.proposal.name}" is missing a safely downloadable icon.`,
    );
  }

  return accept(input, `Source "${input.proposal.name}" passed the AI source audit.`);
}

export const AI_SOURCE_REVIEW_PROPOSALS = [
  {
    name: "One Useful Thing",
    sourceType: "blog",
    sourceUrl: "https://www.oneusefulthing.org/",
    fetchUrl: "https://www.oneusefulthing.org/feed",
  },
  {
    name: "Chip Huyen",
    sourceType: "blog",
    sourceUrl: "https://huyenchip.com/",
    fetchUrl: "https://huyenchip.com/feed.xml",
  },
  { name: "Hamel Husain", sourceType: "blog", sourceUrl: "https://hamel.dev/" },
  { name: "Eugene Yan", sourceType: "blog", sourceUrl: "https://eugeneyan.com/" },
  { name: "Sam Altman", sourceType: "blog", sourceUrl: "https://blog.samaltman.com/" },
  {
    name: "Fei-Fei Li",
    sourceType: "blog",
    sourceUrl: "https://drfeifei.substack.com/",
    fetchUrl: "https://drfeifei.substack.com/feed",
  },
  { name: "François Chollet", sourceType: "x", sourceUrl: "https://x.com/fchollet", handle: "fchollet" },
  {
    name: "SemiAnalysis",
    sourceType: "blog",
    sourceUrl: "https://newsletter.semianalysis.com/",
    fetchUrl: "https://newsletter.semianalysis.com/feed",
  },
  {
    name: "AI Snake Oil",
    sourceType: "blog",
    sourceUrl: "https://www.normaltech.ai/",
    fetchUrl: "https://www.normaltech.ai/feed",
  },
  { name: "fast.ai", sourceType: "blog", sourceUrl: "https://www.fast.ai/" },
  { name: "宝玉", sourceType: "x", sourceUrl: "https://x.com/dotey", handle: "dotey" },
  { name: "Georgi Gerganov", sourceType: "x", sourceUrl: "https://x.com/ggerganov", handle: "ggerganov" },
  { name: "World Labs", sourceType: "blog", sourceUrl: "https://www.worldlabs.ai/blog" },
  {
    name: "Thinking Machines Lab",
    sourceType: "blog",
    sourceUrl: "https://thinkingmachines.ai/blog/",
    fetchUrl: "https://thinkingmachines.ai/blog/index.xml",
  },
  {
    name: "Apple Machine Learning Research",
    sourceType: "blog",
    sourceUrl: "https://machinelearning.apple.com/",
  },
  { name: "NVIDIA Research", sourceType: "blog", sourceUrl: "https://www.nvidia.com/en-us/research/" },
  { name: "xAI News", sourceType: "blog", sourceUrl: "https://x.ai/news" },
  { name: "Qwen Blog", sourceType: "blog", sourceUrl: "https://qwen.ai/blog" },
  { name: "DeepSeek Updates", sourceType: "blog", sourceUrl: "https://api-docs.deepseek.com/news/" },
  {
    name: "Ai2 News",
    sourceType: "blog",
    sourceUrl: "https://allenai.org/news",
    fetchUrl: "https://allenai.org/rss.xml",
  },
  {
    name: "Sakana AI",
    sourceType: "blog",
    sourceUrl: "https://sakana.ai/blog/",
    fetchUrl: "https://sakana.ai/feed.xml",
  },
  { name: "Nous Research", sourceType: "x", sourceUrl: "https://x.com/NousResearch", handle: "NousResearch" },
  { name: "Unsloth", sourceType: "blog", sourceUrl: "https://unsloth.ai/blog" },
  { name: "Perplexity Blog", sourceType: "blog", sourceUrl: "https://www.perplexity.ai/hub/blog" },
  {
    name: "Artificial Analysis",
    sourceType: "blog",
    sourceUrl: "https://artificialanalysis.ai/articles",
  },
  { name: "Epoch AI", sourceType: "blog", sourceUrl: "https://epoch.ai/latest" },
  {
    name: "METR",
    sourceType: "blog",
    sourceUrl: "https://metr.org/blog/",
    fetchUrl: "https://metr.org/feed.xml",
  },
  {
    name: "ARC Prize",
    sourceType: "blog",
    sourceUrl: "https://arcprize.org/blog",
    fetchUrl: "https://arcprize.org/feed.xml",
  },
  {
    name: "Demis Hassabis",
    sourceType: "x",
    sourceUrl: "https://x.com/demishassabis",
    handle: "demishassabis",
  },
  { name: "Yann LeCun", sourceType: "x", sourceUrl: "https://x.com/ylecun", handle: "ylecun" },
  { name: "Jim Fan", sourceType: "x", sourceUrl: "https://x.com/DrJimFan", handle: "DrJimFan" },
  { name: "Thomas Wolf", sourceType: "x", sourceUrl: "https://x.com/Thom_Wolf", handle: "Thom_Wolf" },
  { name: "Ilya Sutskever", sourceType: "x", sourceUrl: "https://x.com/ilyasut", handle: "ilyasut" },
  { name: "Dario Amodei", sourceType: "x", sourceUrl: "https://x.com/DarioAmodei", handle: "DarioAmodei" },
  {
    name: "Thibault Sottiaux",
    sourceType: "x",
    sourceUrl: "https://x.com/thsottiaux",
    handle: "thsottiaux",
  },
  { name: "Nan Yu", sourceType: "x", sourceUrl: "https://x.com/thenanyu", handle: "thenanyu" },
  {
    name: "Madhu Guru",
    sourceType: "x",
    sourceUrl: "https://x.com/realmadhuguru",
    handle: "realmadhuguru",
  },
  { name: "Amjad Masad", sourceType: "x", sourceUrl: "https://x.com/amasad", handle: "amasad" },
  { name: "Guillermo Rauch", sourceType: "x", sourceUrl: "https://x.com/rauchg", handle: "rauchg" },
  { name: "Aaron Levie", sourceType: "x", sourceUrl: "https://x.com/levie", handle: "levie" },
  { name: "Matt Turck", sourceType: "x", sourceUrl: "https://x.com/mattturck", handle: "mattturck" },
] as const satisfies readonly AiSourceReviewProposal[];
