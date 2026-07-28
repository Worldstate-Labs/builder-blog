<!--
  Shared by every user-facing setup, stop, and one-time prompt.
  Node.js is already a FollowBrief prerequisite and is more portable than
  relying on the host's curl/TLS configuration.
-->
```bash
command -v node >/dev/null 2>&1 || {
  echo "FollowBrief requires Node.js 20 or newer on this computer." >&2
  exit 69
}
BOOTSTRAP_URL="${BUILDER_BLOG_URL:-https://followbrief.worldstatelabs.com}/api/skill/bootstrap"
BOOTSTRAP_SCRIPT="$(
  node - "$BOOTSTRAP_URL" <<'NODE'
const url = process.argv[2];
const maxAttempts = 4;
const retryBaseMs = 1_000;
const timeoutMs = 30_000;

function formatErrorCause(error) {
  const cause = error?.cause;
  const causeCode = typeof cause?.code === "string" ? `${cause.code}: ` : "";
  const causeMessage = String(cause?.message || "");
  return causeMessage
    ? `${causeCode}${causeMessage} <- ${String(error?.message || error)}`
    : String(error?.message || error);
}

(async () => {
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const error = Object.assign(new Error(`HTTP ${response.status}`), {
          noRetry:
            response.status !== 408 &&
            response.status !== 429 &&
            response.status < 500,
        });
        throw error;
      }
      process.stdout.write(await response.text());
      return;
    } catch (error) {
      if (error?.noRetry || attempt === maxAttempts) {
        throw new Error(
          `${formatErrorCause(error)}; attempt ${attempt}/${maxAttempts}; ` +
            `elapsed ${Date.now() - startedAt}ms`,
          { cause: error },
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, retryBaseMs * 2 ** (attempt - 1)),
      );
    } finally {
      clearTimeout(timer);
    }
  }
})()
  .catch((error) => {
    const reason = formatErrorCause(error);
    console.error(`FollowBrief bootstrap download failed: ${url}: ${reason}`);
    process.exitCode = 1;
  })
NODE
)" || exit "$?"
/bin/sh -c "$BOOTSTRAP_SCRIPT"
```

{{EXCHANGE_BLOCK}}
