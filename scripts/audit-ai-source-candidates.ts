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

type XFetchResult = FetchResult | readonly FetchItem[];

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type AuditDependencies = {
  evaluateAiSourceAudit: typeof evaluateAiSourceAudit;
  resolvePersonalBuilderInput: typeof resolvePersonalBuilderInput;
  probeAndEnrichSource: typeof probeAndEnrichSource;
  resolveAvatarDataUrl: typeof resolveAvatarDataUrl;
  fetchImpl: FetchLike;
  fetchPersonalBlogBuilderForTest: (
    builder: AuditBuilder,
    options: {
      cutoff: Date;
      limit: number;
      agentModel: string;
      fetchedItemKeys: Set<string>;
      sources: Record<string, never>;
      fetcher?: FetchLike;
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
      fetcher?: FetchLike;
    },
  ) => Promise<XFetchResult>;
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

type ObservedHttpEvidence = {
  finalUrl: string | null;
  status: number | null;
};

type AuditFetchSummary = {
  http: ObservedHttpEvidence;
  fetch: AiSourceAuditFetchEvidence;
  x: AiSourceAuditXEvidence;
  xProfileImageUrl: string | null;
};

type AuditFailureStage = "resolution" | "probe" | "fetch" | "icon";

type AuditCandidateState = {
  stage: AuditFailureStage;
  proposal: AiSourceReviewProposal;
  http: AiSourceAuditInput["http"];
  resolver: AiSourceAuditInput["resolver"];
  probe: AiSourceAuditInput["probe"];
  fetch: AiSourceAuditInput["fetch"];
  x: AiSourceAuditInput["x"];
  icon: AiSourceAuditInput["icon"];
};

const DEFAULT_DEPS: AuditDependencies = {
  evaluateAiSourceAudit,
  resolvePersonalBuilderInput,
  probeAndEnrichSource,
  resolveAvatarDataUrl,
  fetchImpl: fetch,
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
      results.push(await safeAuditProposal({ deps, proposal, index, cutoff }));
    }
  } catch (error) {
    runtimeError = sanitizeText(errorMessage(error));
    if (runtimeError) {
      stderr.write(`${runtimeError}\n`);
    }
  }

  if (runtimeError === null && results.length !== proposals.length) {
    runtimeError = sanitizeText(
      `Audit invariant failed: produced ${results.length} results for ${proposals.length} proposals.`,
    );
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

async function safeAuditProposal({
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
  const state = createCandidateState(proposal);
  try {
    return await auditProposal({ deps, proposal, index, cutoff, state });
  } catch (error) {
    return buildCandidateFailureResult(
      deps,
      state,
      sanitizeText(errorMessage(error)),
    );
  }
}

async function auditProposal({
  deps,
  proposal,
  index,
  cutoff,
  state,
}: {
  deps: AuditDependencies;
  proposal: AiSourceReviewProposal;
  index: number;
  cutoff: Date;
  state: AuditCandidateState;
}): Promise<AiSourceAuditResult> {
  state.stage = "resolution";
  const resolution = await deps.resolvePersonalBuilderInput({
    displayName: proposal.name,
    sourceType: proposal.sourceType,
    sourceValue: proposal.sourceUrl,
  });

  if (!resolution.ok) {
    state.resolver = {
      ok: false,
      finalUrl: null,
      status: null,
    };
    const iconSeed = buildIconEvidenceSeed({
      proposal,
      sourceUrl: proposal.sourceUrl,
      probe: null,
      xProfileImageUrl: null,
    });
    return deps.evaluateAiSourceAudit(
      buildAuditInput({
        proposal,
        http: state.http,
        resolver: state.resolver,
        probe: state.probe,
        fetch: state.fetch,
        x: state.x,
        icon: await resolveIconEvidence({
          deps,
          iconSeed,
        }),
      }),
    );
  }

  const normalized = resolution.value;
  state.resolver = {
    ok: true,
    finalUrl: normalized.sourceUrl,
    status: null,
  };
  const requestedFetchUrl = proposal.fetchUrl ?? normalized.fetchUrl;
  const probeRecorder = createHttpObservationRecorder(deps.fetchImpl);
  state.stage = "probe";
  const probe = await deps.probeAndEnrichSource({
    sourceType: normalized.sourceType,
    sourceUrl: normalized.sourceUrl,
    fetchUrl: requestedFetchUrl,
    handle: normalized.handle,
    fetcher: probeRecorder.fetcher,
  });
  state.probe = {
    ok: probe.ok,
    finalUrl: probeRecorder.observation(normalized.sourceUrl).finalUrl,
    status: probeRecorder.observation(normalized.sourceUrl).status,
    robotsDenied: false,
    loginRequired: false,
  };
  state.http = preferredHttpEvidence(
    state.http,
    probeRecorder.observation(normalized.sourceUrl),
  );

  const builder = buildAuditBuilder({
    proposal,
    normalized,
    probe,
    requestedFetchUrl,
    index,
  });
  let xProfileImageUrl: string | null = null;
  if (builder.kind !== "X") {
    state.stage = "icon";
    const iconSeed = buildIconEvidenceSeed({
      proposal,
      sourceUrl: builder.fetchUrl ?? builder.sourceUrl ?? proposal.sourceUrl,
      probe,
      xProfileImageUrl: null,
    });
    state.icon = {
      ...iconSeed,
      downloaded: false,
    };
    state.icon = await resolveIconEvidence({
      deps,
      iconSeed,
    });
  }
  state.stage = "fetch";
  const fetchSummary = await (
    builder.kind === "X"
      ? fetchXAuditEvidence(deps, builder, cutoff)
      : fetchBlogAuditEvidence(deps, builder, cutoff)
  );
  state.http = preferredHttpEvidence(fetchSummary.http, state.http);
  state.fetch = fetchSummary.fetch;
  state.x = fetchSummary.x;
  xProfileImageUrl = fetchSummary.xProfileImageUrl;

  if (builder.kind === "X") {
    state.stage = "icon";
    const iconSeed = buildIconEvidenceSeed({
      proposal,
      sourceUrl: builder.fetchUrl ?? builder.sourceUrl ?? proposal.sourceUrl,
      probe,
      xProfileImageUrl,
    });
    state.icon = {
      ...iconSeed,
      downloaded: false,
    };
    state.icon = await resolveIconEvidence({
      deps,
      iconSeed,
    });
  }

  return deps.evaluateAiSourceAudit(
      buildAuditInput({
      proposal,
      http: state.http,
      resolver: state.resolver,
      probe: state.probe,
      fetch: state.fetch,
      x: state.x,
      icon: state.icon,
    }),
  );
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
): Promise<AuditFetchSummary> {
  const recorder = createHttpObservationRecorder(deps.fetchImpl, { ignore: isRobotsTxtRequest });
  const result = await deps.fetchPersonalBlogBuilderForTest(
    builder,
    buildFetchOptions(cutoff, { fetcher: recorder.fetcher }),
  );
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
    http: recorder.observation(builder.fetchUrl ?? builder.sourceUrl),
    fetch: {
      itemCount: items.length,
      recentItemCount: recentItems.length,
      actionableTasks,
    },
    x: baseXEvidence(null),
    xProfileImageUrl: null,
  };
}

async function fetchXAuditEvidence(
  deps: AuditDependencies,
  builder: AuditBuilder,
  cutoff: Date,
): Promise<AuditFetchSummary> {
  const lookupObservation = createXLookupRecorder(builder.handle, deps.fetchImpl);
  const result = normalizeXFetchResult(await deps.fetchPersonalXBuilderForTest(
    builder,
    buildFetchOptions(cutoff, { fetcher: lookupObservation.fetcher }),
  ));
  const items = Array.isArray(result.items) ? result.items : [];
  const recentItems = items.filter((item) => isWithinCutoff(item?.publishedAt, cutoff));
  const tasks = Array.isArray(result.agentTasks) ? result.agentTasks : [];
  const tokenState = tasks.some((task) => task?.type === "x_token_missing")
    ? "missing"
    : tasks.some((task) => task?.type === "x_token_invalid")
      ? "invalid"
      : "accepted";
  const exactHandleMatch = tokenState === "accepted" && lookupObservation.exactHandleMatch();

  return {
    http: lookupObservation.httpObservation(builder.sourceUrl),
    fetch: {
      itemCount: items.length,
      recentItemCount: recentItems.length,
      actionableTasks: [],
    },
    x: {
      tokenState,
      requestedHandle: builder.handle,
      resolvedHandle: lookupObservation.resolvedHandle(),
      exactHandleMatch,
    },
    xProfileImageUrl: lookupObservation.profileImageUrl(),
  };
}

function normalizeXFetchResult(result: XFetchResult): FetchResult {
  if (Array.isArray(result)) {
    return {
      items: result,
      agentTasks: [],
    };
  }
  const normalized = result as FetchResult;
  return {
    items: Array.isArray(normalized.items) ? normalized.items : [],
    agentTasks: Array.isArray(normalized.agentTasks) ? normalized.agentTasks : [],
  };
}

function buildFetchOptions(cutoff: Date, extra: { fetcher?: FetchLike } = {}) {
  return {
    cutoff,
    limit: 3,
    agentModel: "candidate-audit",
    fetchedItemKeys: new Set<string>(),
    sources: {} as Record<string, never>,
    ...extra,
  };
}

function buildAuditInput({
  proposal,
  http,
  resolver,
  probe,
  fetch,
  x,
  icon,
}: {
  proposal: AiSourceReviewProposal;
  http: AiSourceAuditInput["http"];
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
    http,
    resolver,
    probe,
    fetch,
    x,
    icon,
  };
}

function buildIconEvidenceSeed({
  proposal,
  sourceUrl,
  probe,
  xProfileImageUrl,
}: {
  proposal: AiSourceReviewProposal;
  sourceUrl: string | null;
  probe: ProbeOutcome | null;
  xProfileImageUrl: string | null;
}): Omit<AiSourceAuditInput["icon"], "downloaded"> {
  const safeUrl = proposal.sourceType === "x"
    ? toSafeAvatarUrl(proposal.avatarUrl) ??
      toSafeAvatarUrl(probe?.enrichment.avatarUrl) ??
      toSafeAvatarUrl(xProfileImageUrl)
    : (() => {
        const fallbackDomain = proposal.avatarDomain ?? hostForUrl(sourceUrl ?? proposal.sourceUrl);
        return (
          toSafeAvatarUrl(proposal.avatarUrl) ??
          toSafeAvatarUrl(probe?.enrichment.avatarUrl) ??
          (fallbackDomain ? googleFaviconUrl(fallbackDomain) : null)
        );
      })();

  return {
    url: safeUrl,
    safeUrl: Boolean(safeUrl),
  };
}

async function resolveIconEvidence({
  deps,
  iconSeed,
}: {
  deps: AuditDependencies;
  iconSeed: Omit<AiSourceAuditInput["icon"], "downloaded">;
}): Promise<AiSourceAuditInput["icon"]> {
  const avatarDataUrl = await deps.resolveAvatarDataUrl(iconSeed.url);
  return {
    ...iconSeed,
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

function createXLookupRecorder(requestedHandle: string | null, fetchImpl: FetchLike) {
  let resolvedHandle: string | null = null;
  let exactHandleMatch = false;
  let profileImageUrl: string | null = null;
  let httpObservation: ObservedHttpEvidence | null = null;
  const requested = normalizeHandleForCompare(requestedHandle);

  return {
    fetcher: async (input: string | URL | Request, init?: RequestInit) => {
      const response = await fetchImpl(input, init);
      if (httpObservation === null) {
        httpObservation = {
          status: response.status,
          finalUrl: response.url || normalizeRequestUrl(input)?.toString() || null,
        };
      }
      await observeXUserLookup({ requestedHandle: requested, input, response }).then((observation) => {
        if (!observation) return;
        resolvedHandle = observation.resolvedHandle;
        exactHandleMatch = observation.exactHandleMatch;
        profileImageUrl = observation.profileImageUrl;
      });
      return response;
    },
    resolvedHandle: () => resolvedHandle,
    exactHandleMatch: () => exactHandleMatch,
    profileImageUrl: () => profileImageUrl,
    httpObservation: (fallbackUrl: string | null) => httpObservation ?? {
      finalUrl: fallbackUrl,
      status: null,
    },
  };
}

async function observeXUserLookup({
  requestedHandle,
  input,
  response,
}: {
  requestedHandle: string | null;
  input: string | URL | Request;
  response: Response;
}): Promise<{ resolvedHandle: string | null; exactHandleMatch: boolean; profileImageUrl: string | null } | null> {
  if (!requestedHandle || !response.ok) return null;

  const url = normalizeRequestUrl(input);
  if (!url) return null;
  const expectedPath = `/2/users/by/username/${encodeURIComponent(requestedHandle)}`;
  if (url.hostname !== "api.x.com" || url.pathname !== expectedPath) return null;

  try {
    const json = (await response.clone().json()) as {
      data?: { id?: unknown; username?: unknown; profile_image_url?: unknown };
    } | null;
    const userId = typeof json?.data?.id === "string" ? json.data.id.trim() : "";
    const username = typeof json?.data?.username === "string" ? json.data.username.trim() : "";
    const profileImageUrl =
      typeof json?.data?.profile_image_url === "string"
        ? json.data.profile_image_url.trim()
        : "";
    const normalizedResolvedHandle = normalizeHandleForCompare(username);
    if (!userId || !normalizedResolvedHandle) {
      return { resolvedHandle: null, exactHandleMatch: false, profileImageUrl: null };
    }
    return {
      resolvedHandle: username,
      exactHandleMatch: normalizedResolvedHandle === requestedHandle,
      profileImageUrl: profileImageUrl || null,
    };
  } catch {
    return null;
  }
}

function createHttpObservationRecorder(
  fetchImpl: FetchLike,
  options: { ignore?: (input: string | URL | Request) => boolean } = {},
) {
  let observation: ObservedHttpEvidence | null = null;

  return {
    fetcher: async (input: string | URL | Request, init?: RequestInit) => {
      const response = await fetchImpl(input, init);
      if (observation === null && !(options.ignore?.(input) ?? false)) {
        observation = {
          status: response.status,
          finalUrl: response.url || normalizeRequestUrl(input)?.toString() || null,
        };
      }
      return response;
    },
    observation: (fallbackUrl: string | null): ObservedHttpEvidence =>
      observation ?? {
        finalUrl: fallbackUrl,
        status: null,
      },
  };
}

function preferredHttpEvidence(
  primary: ObservedHttpEvidence,
  fallback: ObservedHttpEvidence,
): ObservedHttpEvidence {
  return primary.status !== null || primary.finalUrl !== null ? primary : fallback;
}

function isRobotsTxtRequest(input: string | URL | Request): boolean {
  const url = normalizeRequestUrl(input);
  return url?.pathname === "/robots.txt";
}

function normalizeHandleForCompare(handle: string | null | undefined): string | null {
  const value = String(handle ?? "").trim().replace(/^@+/, "").toLowerCase();
  return value || null;
}

function normalizeRequestUrl(input: string | URL | Request): URL | null {
  try {
    if (typeof input === "string") return new URL(input);
    if (input instanceof URL) return new URL(input.toString());
    return new URL(input.url);
  } catch {
    return null;
  }
}

function buildCandidateFailureResult(
  deps: AuditDependencies,
  state: AuditCandidateState,
  detail: string,
): AiSourceAuditResult {
  const fetch =
    state.stage === "icon"
      ? state.fetch
      : {
          ...state.fetch,
          hardFailure: true,
          hardFailureDetail: detail,
        };
  const icon =
    state.stage === "icon"
      ? state.icon
      : state.icon;
  return deps.evaluateAiSourceAudit(
    buildAuditInput({
      proposal: state.proposal,
      http: state.http,
      resolver: state.resolver,
      probe: state.probe,
      fetch,
      x: state.x,
      icon,
    }),
  );
}

function createCandidateState(proposal: AiSourceReviewProposal): AuditCandidateState {
  return {
    stage: "resolution",
    proposal,
    http: {
      finalUrl: null,
      status: null,
    },
    resolver: {
      ok: true,
      finalUrl: proposal.sourceUrl,
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
    icon: {
      url: null,
      safeUrl: false,
      downloaded: false,
    },
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
    .replace(/\bfile:\/\/\/[^\s"']+/gi, "[redacted-local-path]")
    .replace(/(^|[\s="'(])\/(?!\/)[^\s"']+/gm, "$1[redacted-local-path]")
    .replace(/(^|[\s="'(])(?:[A-Za-z]:\\|\\\\)[^\s"']+/gm, "$1[redacted-local-path]")
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
