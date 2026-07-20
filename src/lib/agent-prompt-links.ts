import { createHash, randomBytes } from "node:crypto";

export const AGENT_PROMPT_LINK_TTL_MS = 10 * 60 * 1000;
export const AGENT_PROMPT_LINK_TOKEN_PATTERN = /^fbp_[A-Za-z0-9_-]{22,128}$/;
export const AGENT_PROMPT_LINK_PRIVACY_HEADERS = Object.freeze({
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
});

export type Runtime = "claude" | "codex" | "hermes" | "openclaw";
export type Frequency = "1h" | "daily" | "weekly";
export type ExposedPromptJob =
  | "library-once"
  | "digest-once"
  | "library-cron-setup"
  | "digest-cron-setup"
  | "library-cron-stop"
  | "digest-cron-stop"
  | "cloud-library-cron-setup"
  | "cloud-library-cron-stop";

export type AgentPromptRenderOptions = {
  runtime?: Runtime;
  frequency?: Frequency;
  force?: boolean;
  fetchDays?: number;
  parallelWorkers?: number;
};

const RUNTIMES: Runtime[] = ["claude", "codex", "hermes", "openclaw"];
const FREQUENCIES: Frequency[] = ["1h", "daily", "weekly"];
const JOB_ALLOWED_KEYS: Record<ExposedPromptJob, readonly (keyof AgentPromptRenderOptions)[]> = {
  "library-once": ["runtime", "force", "fetchDays", "parallelWorkers"],
  "digest-once": ["runtime", "force", "parallelWorkers"],
  "library-cron-setup": ["runtime", "frequency", "force", "fetchDays", "parallelWorkers"],
  "digest-cron-setup": ["runtime", "frequency", "force", "parallelWorkers"],
  "library-cron-stop": [],
  "digest-cron-stop": [],
  "cloud-library-cron-setup": ["runtime", "fetchDays", "parallelWorkers"],
  "cloud-library-cron-stop": ["runtime"],
};
const EXPOSED_PROMPT_JOBS = new Set<ExposedPromptJob>(Object.keys(JOB_ALLOWED_KEYS) as ExposedPromptJob[]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertAllowedString<T extends string>(
  key: keyof AgentPromptRenderOptions,
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== "string") {
    throw new Error(`Prompt link option ${key} must be a string.`);
  }
  if (!allowed.includes(value as T)) {
    throw new Error(`Prompt link option ${key} is invalid.`);
  }
  return value as T;
}

function assertAllowedBoolean(key: keyof AgentPromptRenderOptions, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Prompt link option ${key} must be a boolean.`);
  }
  return value;
}

function assertIntegerInRange(
  key: keyof AgentPromptRenderOptions,
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Prompt link option ${key} must be an integer number.`);
  }
  if (value < minimum || value > maximum) {
    throw new Error(`Prompt link option ${key} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function parseAgentPromptLinkOptions(
  job: ExposedPromptJob,
  input: unknown,
): AgentPromptRenderOptions {
  if (!EXPOSED_PROMPT_JOBS.has(job)) {
    throw new Error("Prompt link job is invalid.");
  }
  if (!isPlainObject(input)) {
    throw new Error("Prompt link options must be an object.");
  }

  const allowedKeys = new Set<keyof AgentPromptRenderOptions>(JOB_ALLOWED_KEYS[job]);
  const output: AgentPromptRenderOptions = {};

  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key as keyof AgentPromptRenderOptions)) {
      throw new Error(`Unknown or not allowed prompt link option: ${key}.`);
    }
  }

  if ("runtime" in input && input.runtime !== undefined) {
    output.runtime = assertAllowedString("runtime", input.runtime, RUNTIMES);
  }
  if ("frequency" in input && input.frequency !== undefined) {
    output.frequency = assertAllowedString("frequency", input.frequency, FREQUENCIES);
  }
  if ("force" in input && input.force !== undefined) {
    output.force = assertAllowedBoolean("force", input.force);
  }
  if ("fetchDays" in input && input.fetchDays !== undefined) {
    output.fetchDays = assertIntegerInRange("fetchDays", input.fetchDays, 1, 90);
  }
  if ("parallelWorkers" in input && input.parallelWorkers !== undefined) {
    output.parallelWorkers = assertIntegerInRange("parallelWorkers", input.parallelWorkers, 1, 20);
  }

  return output;
}

export function createAgentPromptLinkToken(): string {
  return `fbp_${randomBytes(16).toString("base64url")}`;
}

export function hashAgentPromptLinkToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
