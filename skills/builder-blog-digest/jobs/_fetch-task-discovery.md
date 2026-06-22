<!--
  Candidate-discovery part of the fetch-task execution contract. Split from
  the per-task core so the worker prompt (library-worker.md) can reuse the core
  without inheriting discovery. The runner completes discovery in a dedicated
  pre-pass (library-discovery.md) BEFORE sharding, so workers only ever see
  normal post tasks.

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
  `evidence`. Stop after writing `library-discovery-result.json`; the runner
  expands discovery results into normal post tasks before workers start.
