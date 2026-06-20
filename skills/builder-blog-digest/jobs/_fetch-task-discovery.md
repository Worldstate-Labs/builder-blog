<!--
  Candidate-discovery part of the fetch-task execution contract. Split from
  the per-task core so the parallel worker prompt (library-worker.md) can
  reuse the core without inheriting discovery: in a sharded run the runner
  completes discovery in a dedicated pre-pass (library-discovery.md) BEFORE
  sharding, so workers only ever see normal post tasks. library-once.md and
  library-cron.md include discovery + core + syncing in sequence, which
  renders the same single-agent contract as before the split.

      {{INCLUDE:fetch-task-discovery TMP_JOB="..."}}
-->
Fetch task boundary:
- Normal `fetch_post` entries represent post-level work: one post that must end
  as one synced item with both `body` and `summary`.
- An entry with `agentWorkType="candidate_discovery_fallback"` may appear only
  in the pre-expansion fetch result. It is a pre-post discovery entry, not a
  post task or feed item. Complete all such entries first by following
  `task.discoveryInstructions.prompt` and writing a strict JSON payload to:

```text
$TMP_DIR/library-discovery-result.json
```

  Shape:
  `{ candidateDiscoveries: [{ fetchTaskId, status, candidates?, reason?, evidence? }] }`.
  For `status="ok"`, include only verified candidates returned by the discovery
  prompt. For blocked/failed discovery, include `reason` and concrete
  `evidence`. Then run:

```bash
AGENT_DIR="${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}"
ACCOUNT_SLUG="$(printf '%s' "${BUILDER_BLOG_ACCOUNT:-default}" | tr -c 'a-zA-Z0-9' '_')"
TMP_DIR="${BUILDER_BLOG_JOB_TMP_DIR:-$AGENT_DIR/tmp/accounts/$ACCOUNT_SLUG/{{TMP_JOB}}}"
BUILDER_BLOG_ACCOUNT="${BUILDER_BLOG_ACCOUNT}" \
node "${BUILDER_BLOG_AGENT_DIR:-$HOME/.builder-blog}/builder-digest.mjs" expand-discovery \
  --tasks "$TMP_DIR/library-fetch-result.json" \
  --file "$TMP_DIR/library-discovery-result.json" \
  --out "$TMP_DIR/library-fetch-expanded.json"
mv "$TMP_DIR/library-fetch-expanded.json" "$TMP_DIR/library-fetch-result.json"
```

  Continue this contract against the expanded `library-fetch-result.json`.
  The CLI guarantees the expanded `fetchTasks` array contains only normal
  post tasks; discovery entries are not synced directly.
