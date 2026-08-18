const YTDLP_STALE_AFTER_DAYS = 90;
const MEDIA_RETRY_MIN_REMAINING_MS = 30_000;
const MAX_DIAGNOSTIC_CHARS = 600;

/**
 * @typedef {{
 *   ok?: boolean,
 *   code?: number | null,
 *   stdout?: string,
 *   stderr?: string,
 *   timedOut?: boolean,
 *   outputMissing?: boolean,
 * }} MediaToolResult
 */

/**
 * @typedef {{
 *   code: string,
 *   stage: string,
 *   retryable: boolean,
 *   exitCode?: number,
 *   httpStatus?: number,
 *   diagnostic?: string,
 *   maintenanceWarnings?: string[],
 *   processAttempts?: number,
 *   tool?: string,
 *   toolVersion?: string | null,
 * }} MediaToolFailure
 */

function resultText(result) {
  return [result?.stderr, result?.stdout]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
}

function versionDate(version) {
  const match = String(version || "").trim().match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function ytDlpVersionIsOutdated(version, now = new Date()) {
  const releasedAt = versionDate(version);
  const checkedAt = now instanceof Date ? now : new Date(now);
  if (!releasedAt || Number.isNaN(checkedAt.getTime())) return false;
  return checkedAt.getTime() - releasedAt.getTime() > YTDLP_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * @param {{result?: MediaToolResult | null, toolVersion?: string, now?: Date}} [options]
 */
export function ytDlpMaintenanceWarnings({ result = null, toolVersion = "", now = new Date() } = {}) {
  const text = resultText(result);
  if (ytDlpVersionIsOutdated(toolVersion, now) || /older than 90 days/i.test(text)) {
    return ["yt_dlp_outdated"];
  }
  return [];
}

function sanitizeUrl(value) {
  const trailing = value.match(/[),.;:]+$/)?.[0] || "";
  const candidate = trailing ? value.slice(0, -trailing.length) : value;
  try {
    const parsed = new URL(candidate);
    const redactedQuery = parsed.search ? "?[redacted]" : "";
    return `${parsed.origin}${parsed.pathname}${redactedQuery}${trailing}`;
  } catch {
    return value.replace(/\?.*$/, "?[redacted]");
  }
}

export function sanitizeMediaDiagnostic(value) {
  return String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\b(?:Authorization|Cookie|Set-Cookie|X-YouTube-Identity-Token)\s*[:=]\s*[^\r\n]+/gi, (line) => {
      const separator = line.includes(":") ? ":" : "=";
      return `${line.split(separator, 1)[0]}${separator} [redacted]`;
    })
    .replace(/https?:\/\/[^\s"'<>]+/gi, sanitizeUrl)
    .replace(/\/(?:Users|home)\/[^/\s]+/g, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, "~")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_DIAGNOSTIC_CHARS);
}

function httpStatusFromText(text) {
  const match = text.match(/(?:HTTP Error|HTTP status(?: code)?|status code)\s*[:=]?\s*(\d{3})/i);
  return match ? Number(match[1]) : null;
}

function baseFailure(code, stage, retryable, result, options = {}) {
  const diagnostic = sanitizeMediaDiagnostic(resultText(result));
  return {
    code,
    stage,
    retryable,
    ...(Number.isInteger(result?.code) ? { exitCode: result.code } : {}),
    ...(options.httpStatus ? { httpStatus: options.httpStatus } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    ...(options.maintenanceWarnings?.length
      ? { maintenanceWarnings: options.maintenanceWarnings }
      : {}),
  };
}

/**
 * @param {{
 *   stage?: string,
 *   result?: MediaToolResult | null,
 *   toolVersion?: string,
 *   now?: Date,
 *   potProviderAvailable?: boolean | null,
 * }} [options]
 * @returns {MediaToolFailure | null}
 */
export function classifyMediaToolFailure({
  stage,
  result,
  toolVersion = "",
  now = new Date(),
  potProviderAvailable = null,
} = {}) {
  const normalizedStage = String(stage || "").trim();
  if (result?.ok && !result?.outputMissing) return null;
  const text = resultText(result);
  const lower = text.toLowerCase();
  const maintenanceWarnings = ytDlpMaintenanceWarnings({ result, toolVersion, now });

  if (normalizedStage === "prepare_audio") {
    return baseFailure("media_convert_failed", normalizedStage, false, result);
  }
  if (normalizedStage === "transcribe") {
    return baseFailure("media_transcription_failed", normalizedStage, false, result);
  }

  if (result?.outputMissing) {
    return baseFailure(
      "media_download_output_missing",
      "download",
      true,
      result,
      { maintenanceWarnings },
    );
  }

  const httpStatus = httpStatusFromText(text);
  const durableAccessFailure = [
    /sign in|log in|login required|members[- ]only|private video|age[- ]restricted/i,
    /not available in your country|geo(?:graphic)?[- ]restricted/i,
    /confirm you(?:'|’)re not a bot|po token.*(?:required|missing)|authentication required/i,
  ].some((pattern) => pattern.test(text));
  if (durableAccessFailure) {
    return baseFailure(
      "media_download_access_required",
      "download",
      false,
      result,
      { httpStatus, maintenanceWarnings },
    );
  }

  // YouTube's PO-token wall. yt-dlp phrases it as "formats require a GVS PO
  // Token which was not provided" and then fails with either a format error or
  // a plain 403. On a machine without the local PO token provider the fix is
  // installing the provider, not retrying — and the check must run before the
  // `unavailable` patterns because the same output usually also says
  // "Requested format is not available". Callers that do not report provider
  // availability (potProviderAvailable == null) keep the legacy classification.
  const potTokenRequired = /requires? a GVS PO Token/i.test(text);
  if (potProviderAvailable === false && (potTokenRequired || httpStatus === 403)) {
    return baseFailure(
      "media_download_pot_provider_missing",
      "download",
      false,
      result,
      { httpStatus, maintenanceWarnings },
    );
  }
  if (potProviderAvailable === true && potTokenRequired) {
    return baseFailure(
      "media_download_forbidden",
      "download",
      true,
      result,
      { httpStatus, maintenanceWarnings },
    );
  }

  const unavailable = [
    /video (?:is )?unavailable|has been removed|deleted by the uploader/i,
    /copyright|no video formats found|requested format is not available/i,
  ].some((pattern) => pattern.test(text));
  if (unavailable) {
    return baseFailure(
      "media_download_unavailable",
      "download",
      false,
      result,
      { httpStatus, maintenanceWarnings },
    );
  }

  if (httpStatus === 403) {
    return baseFailure(
      "media_download_forbidden",
      "download",
      true,
      result,
      { httpStatus, maintenanceWarnings },
    );
  }
  if (httpStatus === 429) {
    return baseFailure(
      "media_download_rate_limited",
      "download",
      true,
      result,
      { httpStatus, maintenanceWarnings },
    );
  }
  if (
    result?.timedOut ||
    (httpStatus != null && httpStatus >= 500) ||
    /timed? out|timeout|temporary failure|connection (?:reset|refused)|network is unreachable|remote end closed/i.test(lower)
  ) {
    return baseFailure(
      "media_download_temporarily_unavailable",
      "download",
      true,
      result,
      { httpStatus, maintenanceWarnings },
    );
  }

  return baseFailure(
    "media_download_failed",
    "download",
    true,
    result,
    { httpStatus, maintenanceWarnings },
  );
}

/**
 * @param {{failure: Pick<MediaToolFailure, "retryable">, attempt: number, remainingBudgetMs: number}} options
 */
export function shouldRetryMediaToolFailure({ failure, attempt, remainingBudgetMs }) {
  return Boolean(
    failure?.retryable &&
    Number(attempt) < 2 &&
    Number(remainingBudgetMs) >= MEDIA_RETRY_MIN_REMAINING_MS,
  );
}

/**
 * @param {MediaToolFailure | null | undefined} failure
 */
export function mediaFailureEvidence(failure) {
  if (!failure) return null;
  return {
    code: String(failure.code || "media_download_failed"),
    stage: String(failure.stage || "download"),
    retryable: Boolean(failure.retryable),
    ...(Number.isInteger(failure.exitCode) ? { exitCode: failure.exitCode } : {}),
    ...(Number.isInteger(failure.httpStatus) ? { httpStatus: failure.httpStatus } : {}),
    ...(Number.isInteger(failure.processAttempts) ? { processAttempts: failure.processAttempts } : {}),
    ...(failure.tool ? { tool: String(failure.tool) } : {}),
    ...(failure.toolVersion ? { toolVersion: String(failure.toolVersion) } : {}),
    ...(failure.diagnostic ? { diagnostic: sanitizeMediaDiagnostic(failure.diagnostic) } : {}),
    ...(Array.isArray(failure.maintenanceWarnings) && failure.maintenanceWarnings.length > 0
      ? { maintenanceWarnings: [...failure.maintenanceWarnings] }
      : {}),
  };
}
