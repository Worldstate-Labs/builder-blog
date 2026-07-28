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
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 30_000);
(async () => {
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  process.stdout.write(await response.text());
})()
  .catch((error) => {
    const reason =
      error?.name === "AbortError"
        ? "timed out after 30 seconds"
        : String(error?.message || error);
    console.error(`FollowBrief bootstrap download failed: ${url}: ${reason}`);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(timer));
NODE
)" || exit "$?"
/bin/sh -c "$BOOTSTRAP_SCRIPT"
```

{{EXCHANGE_BLOCK}}
