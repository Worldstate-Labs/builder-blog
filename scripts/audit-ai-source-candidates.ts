#!/usr/bin/env node

import { createHash } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { ProbeOutcome } from "../src/lib/builder-enrichment";
import {
  probeAndEnrichSource,
  resolveAvatarDataUrl,
  toSafeAvatarUrl,
} from "../src/lib/builder-enrichment";
import {
  AI_SOURCE_REVIEW_PROPOSALS,
  evaluateAiSourceAudit,
  type AiSourceAuditFetchEvidence,
  type AiSourceAuditInput,
  type AiSourceAuditResult,
  type AiSourceAuditXEvidence,
  type AiSourceReviewProposal,
} from "../src/lib/ai-source-candidate-review";
import {
  resolvePersonalBuilderInput,
  type PersonalBuilderInput,
  type Resolution,
} from "../src/lib/personal-builder-input";
import { fetchPersonalBlogBuilderForTest, fetchPersonalXBuilderForTest } from "./builder-digest.mjs";

const NINETY_DAY_CUTOFF_MS = 90 * 24 * 60 * 60 * 1000;

type AuditBuilder = Pick<
  PersonalBuilderInput,
  "name" | "sourceType" | "handle" | "sourceUrl" | "fetchUrl"
> & {
  id: string;
  kind: "BLOG" | "X";
};

type FetchItem = {
  publishedAt?: string | Date | null;
};

type FetchTask = {
  type?: string | null;
  agentMessage?: string | null;
  item?: {
    publishedAt?: string | Date | null;
  } | null;
};

type FetchResult = {
  items?: readonly FetchItem[];
  agentTasks?: readonly FetchTask[];
};

type AuditDependencies = {
  evaluateAiSourceAudit: typeof evaluateAiSourceAudit;
  resolvePersonalBuilderInput: typeof resolvePersonalBuilderInput;
  probeAndEnrichSource: typeof probeAndEnrichSource;
  resolveAvatarDataUrl: typeof resolveAvatarDataUrl;
  fetchPersonalBlogBuilderForTest: (
    builder: AuditBuilder,
    options: {
      cutoff: Date;
      limit: number;
      agentModel: string;
      fetchedItemKeys: Set<string>;
      sources: Record<string, never>;
    },
  ) => Promise<FetchResult>;
  fetchPersonalXBuilderForTest: (
    builder: AuditBuilder,
    options: {
      cutoff: Date;
      limit: number;
      agentModel: string;
      fetchedItemKeys: Set<string>;
      sources: Record<string, never>;
    },
  ) => Promise<FetchResult>;
};

type RunAuditCliOptions = {
  now?: () => Date;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  proposals?: readonly AiSourceReviewProposal[];
  deps?: Partial<AuditDependencies>;
};

type AuditJsonOutput = {
  generatedAt: string;
  cutoff: string;
  proposalCount: number;
  resultCount: number;
  complete: boolean;
  runtimeError: string | null;
  results: AiSourceAuditResult[];
};

const DEFAULT_DEPS: AuditDependencies = {
  evaluateAiSourceAudit,
  resolvePersonalBuilderInput,
  probeAndEnrichSource,
  resolveAvatarDataUrl,
  fetchPersonalBlogBuilderForTest,
  fetchPersonalXBuilderForTest,
};

export async function runAuditCli(options: RunAuditCliOptions = {}): Promise<number> {
  const deps = { ...DEFAULT_DEPS, ...options.deps };
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const proposals = options.proposals ?? AI_SOURCE_REVIEW_PROPOSALS;
  const now = options.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - NINETY_DAY_CUTOFF_MS);

  const results: AiSourceAuditResult[] = [];
  let runtimeError: string | null = null;

  try {
    for (const [index, proposal] of proposals.entries()) {
      results.push(
        await auditProposal({
          deps,
          proposal,
          index,
          cutoff,
        }),
      );
    }
  } catch (error) {
    runtimeError = sanitizeText(errorMessage(error));
    if (runtimeError) {
      stderr.write(`${runtimeError}\n`);
    }
  }

  const complete = runtimeError === null && results.length === proposals.length;
  const output: AuditJsonOutput = {
    generatedAt: now.toISOString(),
    cutoff: cutoff.toISOString(),
    proposalCount: proposals.length,
    resultCount: results.length,
    complete,
    runtimeError,
    results: results.map(sanitizeAuditResult),
  };

  stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return complete ? 0 : 1;
}

async function auditProposal({
  deps,
  proposal,
  index,
  cutoff,
}: {
  deps: AuditDependencies;
  proposal: AiSourceReviewProposal;
  index: number;
  cutoff: Date;
}): Promise<AiSourceAuditResult> {
  const resolution = await deps.resolvePersonalBuilderInput({
    displayName: proposal.name,
    sourceType: proposal.sourceType,
    sourceValue: proposal.sourceUrl,
  });

  if (!resolution.ok) {
    return deps.evaluateAiSourceAudit(
      buildAuditInput({
        proposal,
        resolver: {
          ok: false,
          finalUrl: null,
          status: null,
        },
        probe: {
          ok: true,
          finalUrl: null,
          status: null,
          robotsDenied: false,
          loginRequired: false,
        },
        fetch: emptyFetchEvidence(),
        x: baseXEvidence(proposal.handle ?? null),
        icon: await resolveIconEvidence({
          deps,
          proposal,
          sourceUrl: proposal.sourceUrl,
          probe: null,
        }),
      }),
    );
  }

  const normalized = resolution.value;
  const requestedFetchUrl = proposal.fetchUrl ?? normalized.fetchUrl;
  const probe = await deps.probeAndEnrichSource({
    sourceType: normalized.sourceType,
    sourceUrl: normalized.sourceUrl,
    fetchUrl: requestedFetchUrl,
    handle: normalized.handle,
  });

  const builder = buildAuditBuilder({
    proposal,
    normalized,
    probe,
    requestedFetchUrl,
    index,
  });
  const icon = await resolveIconEvidence({
    deps,
    proposal,
    sourceUrl: builder.fetchUrl ?? builder.sourceUrl ?? proposal.sourceUrl,
    probe,
  });

  try {
    const fetchSummary =
      builder.kind === "X"
        ? await fetchXAuditEvidence(deps, builder, cutoff)
        : await fetchBlogAuditEvidence(deps, builder, cutoff);

    return deps.evaluateAiSourceAudit(
      buildAuditInput({
        proposal,
        resolver: {
          ok: true,
          finalUrl: normalized.sourceUrl,
          status: null,
        },
        probe: {
          ok: probe.ok,
          finalUrl: builder.fetchUrl ?? builder.sourceUrl,
          status: null,
          robotsDenied: false,
          loginRequired: false,
        },
        fetch: fetchSummary.fetch,
        x: fetchSummary.x,
        icon,
      }),
    );
  } catch (error) {
    return deps.evaluateAiSourceAudit(
      buildAuditInput({
        proposal,
        resolver: {
          ok: true,
          finalUrl: normalized.sourceUrl,
          status: null,
        },
        probe: {
          ok: probe.ok,
          finalUrl: builder.fetchUrl ?? builder.sourceUrl,
          status: null,
          robotsDenied: false,
          loginRequired: false,
        },
        fetch: {
          ...emptyFetchEvidence(),
          hardFailure: true,
          hardFailureDetail: sanitizeText(errorMessage(error)),
        },
        x:
          builder.kind === "X"
            ? baseXEvidence(builder.handle)
            : baseXEvidence(null),
        icon,
      }),
    );
  }
}

function buildAuditBuilder({
  proposal,
  normalized,
  probe,
  requestedFetchUrl,
  index,
}: {
  proposal: AiSourceReviewProposal;
  normalized: PersonalBuilderInput;
  probe: ProbeOutcome;
  requestedFetchUrl: string | null;
  index: number;
}): AuditBuilder {
  return {
    id: stableAuditBuilderId(proposal, index),
    kind: normalized.kind === "X" ? "X" : "BLOG",
    name: normalized.name,
    sourceType: normalized.sourceType,
    handle: normalized.handle,
    sourceUrl: normalized.sourceUrl,
    fetchUrl: proposal.fetchUrl ?? probe.discoveredFetchUrl ?? requestedFetchUrl,
  };
}

async function fetchBlogAuditEvidence(
  deps: AuditDependencies,
  builder: AuditBuilder,
  cutoff: Date,
): Promise<{
  fetch: AiSourceAuditFetchEvidence;
  x: AiSourceAuditXEvidence;
}> {
  const result = await deps.fetchPersonalBlogBuilderForTest(builder, buildFetchOptions(cutoff));
  const items = Array.isArray(result.items) ? result.items : [];
  const recentItems = items.filter((item) => isWithinCutoff(item?.publishedAt, cutoff));
  const actionableTasks = (Array.isArray(result.agentTasks) ? result.agentTasks : [])
    .filter(
      (task) =>
        task?.type === "blog_article_fetch" &&
        isWithinCutoff(task?.item?.publishedAt, cutoff),
    )
    .map((task) => ({
      type: String(task?.type ?? "blog_article_fetch"),
      recentDiscoveredContent: true,
    }));

  return {
    fetch: {
      itemCount: items.length,
      recentItemCount: recentItems.length,
      actionableTasks,
    },
    x: baseXEvidence(null),
  };
}

async function fetchXAuditEvidence(
  deps: AuditDependencies,
  builder: AuditBuilder,
  cutoff: Date,
): Promise<{
  fetch: AiSourceAuditFetchEvidence;
  x: AiSourceAuditXEvidence;
}> {
  const result = await deps.fetchPersonalXBuilderForTest(builder, buildFetchOptions(cutoff));
  const items = Array.isArray(result.items) ? result.items : [];
  const recentItems = items.filter((item) => isWithinCutoff(item?.publishedAt, cutoff));
  const tasks = Array.isArray(result.agentTasks) ? result.agentTasks : [];
  const tokenState = tasks.some((task) => task?.type === "x_token_missing")
    ? "missing"
    : tasks.some((task) => task?.type === "x_token_invalid")
      ? "invalid"
      : "accepted";
  const exactHandleMatch = tokenState === "accepted" && Boolean(builder.handle);

  return {
    fetch: {
      itemCount: items.length,
      recentItemCount: recentItems.length,
      actionableTasks: [],
    },
    x: {
      tokenState,
      requestedHandle: builder.handle,
      resolvedHandle: exactHandleMatch ? builder.handle : null,
      exactHandleMatch,
    },
  };
}

function buildFetchOptions(cutoff: Date) {
  return {
    cutoff,
    limit: 3,
    agentModel: "candidate-audit",
    fetchedItemKeys: new Set<string>(),
    sources: {} as Record<string, never>,
  };
}

function buildAuditInput({
  proposal,
  resolver,
  probe,
  fetch,
  x,
  icon,
}: {
  proposal: AiSourceReviewProposal;
  resolver: AiSourceAuditInput["resolver"];
  probe: AiSourceAuditInput["probe"];
  fetch: AiSourceAuditInput["fetch"];
  x: AiSourceAuditInput["x"];
  icon: AiSourceAuditInput["icon"];
}): AiSourceAuditInput {
  return {
    proposal: {
      name: proposal.name,
      sourceType: proposal.sourceType,
      sourceUrl: proposal.sourceUrl,
      ...(proposal.fetchUrl ? { fetchUrl: proposal.fetchUrl } : {}),
      ...(proposal.handle ? { handle: proposal.handle } : {}),
      ...(proposal.avatarDomain ? { avatarDomain: proposal.avatarDomain } : {}),
      ...(proposal.avatarUrl ? { avatarUrl: proposal.avatarUrl } : {}),
    },
    http: {
      finalUrl: probe.finalUrl ?? resolver.finalUrl,
      status: probe.status ?? resolver.status,
    },
    resolver,
    probe,
    fetch,
    x,
    icon,
  };
}

async function resolveIconEvidence({
  deps,
  proposal,
  sourceUrl,
  probe,
}: {
  deps: AuditDependencies;
  proposal: AiSourceReviewProposal;
  sourceUrl: string | null;
  probe: ProbeOutcome | null;
}): Promise<AiSourceAuditInput["icon"]> {
  const fallbackDomain = proposal.avatarDomain ?? hostForUrl(sourceUrl ?? proposal.sourceUrl);
  const safeUrl =
    toSafeAvatarUrl(proposal.avatarUrl) ??
    toSafeAvatarUrl(probe?.enrichment.avatarUrl) ??
    (fallbackDomain ? googleFaviconUrl(fallbackDomain) : null);
  const avatarDataUrl = await deps.resolveAvatarDataUrl(safeUrl);

  return {
    url: safeUrl,
    safeUrl: Boolean(safeUrl),
    downloaded: Boolean(avatarDataUrl),
  };
}

function googleFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function hostForUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).host || null;
  } catch {
    return null;
  }
}

function baseXEvidence(handle: string | null): AiSourceAuditXEvidence {
  return {
    tokenState: "unknown",
    requestedHandle: handle,
    resolvedHandle: null,
    exactHandleMatch: false,
  };
}

function emptyFetchEvidence(): AiSourceAuditFetchEvidence {
  return {
    itemCount: 0,
    recentItemCount: 0,
    actionableTasks: [],
  };
}

function stableAuditBuilderId(proposal: AiSourceReviewProposal, index: number): string {
  const hash = createHash("sha256")
    .update(`${proposal.sourceType}:${proposal.sourceUrl}:${proposal.handle ?? ""}`)
    .digest("hex")
    .slice(0, 12);
  return `candidate-audit:${index}:${hash}`;
}

function isWithinCutoff(value: string | Date | null | undefined, cutoff: Date): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() >= cutoff.getTime();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

function sanitizeAuditResult(result: AiSourceAuditResult): AiSourceAuditResult {
  return {
    proposal: {
      ...result.proposal,
      sourceUrl: sanitizeText(result.proposal.sourceUrl),
      ...(result.proposal.fetchUrl
        ? { fetchUrl: sanitizeText(result.proposal.fetchUrl) }
        : {}),
      ...(result.proposal.avatarUrl
        ? { avatarUrl: sanitizeText(result.proposal.avatarUrl) }
        : {}),
      ...(result.proposal.avatarDomain
        ? { avatarDomain: sanitizeText(result.proposal.avatarDomain) }
        : {}),
    },
    http: {
      finalUrl: sanitizeNullableText(result.http.finalUrl),
      status: result.http.status,
    },
    resolver: {
      ...result.resolver,
      finalUrl: sanitizeNullableText(result.resolver.finalUrl),
    },
    probe: {
      ...result.probe,
      finalUrl: sanitizeNullableText(result.probe.finalUrl),
    },
    fetch: {
      ...result.fetch,
      hardFailureDetail: sanitizeNullableText(result.fetch.hardFailureDetail ?? null),
    },
    x: {
      ...result.x,
      requestedHandle: sanitizeNullableText(result.x.requestedHandle),
      resolvedHandle: sanitizeNullableText(result.x.resolvedHandle),
    },
    icon: {
      ...result.icon,
      url: sanitizeNullableText(result.icon.url),
    },
    accepted: result.accepted,
    reason: result.reason,
    detail: sanitizeText(result.detail),
  };
}

function sanitizeNullableText(value: string | null): string | null {
  return value ? sanitizeText(value) : null;
}

function sanitizeText(value: string): string {
  return value
    .replace(/Authorization\s*:\s*Bearer\s+[^\s"']+/gi, "[redacted-secret]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/g, "[redacted-secret]")
    .replace(/X_BEARER_TOKEN/gi, "[redacted-token]")
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[redacted-data-url]")
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/gi, "[redacted-database-url]")
    .replace(/\/Users\/[^\s"']+/g, "[redacted-local-path]")
    .replace(/body\s*=\s*<[^>]+>[\s\S]*$/gi, "[redacted-response-body]");
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  void runAuditCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
