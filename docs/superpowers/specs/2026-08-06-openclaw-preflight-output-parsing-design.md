# OpenClaw Preflight Output Parsing Design

## Problem

The OpenClaw runtime preflight can return the required readiness marker inside a
pretty-printed JSON response that is preceded by non-JSON migration notes. The
current detector accepts a raw marker, a whole JSON document, or one JSON
document per line. It cannot parse a multi-line JSON document after a text
preamble, so it reports `runtime_preflight_failed` and exits 78 even when
OpenClaw returned the exact success marker.

This false negative stops the library fetch before source discovery and worker
assignment.

## Scope

Change only the OpenClaw library preflight marker detector and its tests. Do not
change OpenClaw authentication checks, timeout handling, exit codes, fetch
planning, worker execution, or the Codex and Claude runtime paths.

## Required Behavior

The detector must accept the readiness marker when it appears in any of these
supported shapes:

- A direct JSON object.
- A JSON/JSONL OpenClaw response envelope.
- A nested JSON string in an OpenClaw response envelope.
- A complete multi-line JSON response envelope preceded or followed by
  non-JSON diagnostic text.

The detector must continue to fail closed when:

- `followbriefRuntimePreflight` is not exactly `"ok"`.
- `runtimeReady` is not exactly the boolean `true`.
- The two values are not properties of the same parsed object.
- The JSON containing the marker is malformed or truncated.
- The output contains only descriptive text or example field names.

## Design

Replace text-wide regular-expression acceptance with semantic JSON parsing.
The Node helper embedded in `agent_output_has_openclaw_preflight_marker` will:

1. Read the bounded preflight output file.
2. Enumerate complete JSON object or array candidates within decorated text by
   scanning balanced braces/brackets while respecting JSON string escaping.
3. Parse each complete candidate independently.
4. Recursively traverse parsed arrays and objects.
5. When a string value itself starts with an object or array, parse and traverse
   that nested JSON value.
6. Return success only when one parsed object contains both exact readiness
   properties.

Direct JSON and JSONL remain supported because each is also a complete JSON
candidate. Non-JSON diagnostics are ignored. A malformed candidate is skipped;
it never becomes success evidence.

The preflight caller remains marker-driven rather than process-code-driven. This
preserves the existing behavior in which a semantically valid readiness marker
can pass even if OpenClaw's generic runtime wrapper does not recognize the tiny
preflight response as a normal fetch/digest completion.

## Alternatives Rejected

- Parse from the first `{` to the last `}`: a diagnostic containing braces or
  multiple JSON documents would make this ambiguous and brittle.
- Split stdout and stderr and assume diagnostics use stderr: OpenClaw output
  channel behavior is not a stable contract, and the observed response was
  already captured as one combined stream.
- Remove or bypass preflight: this would lose the early authentication, timeout,
  and runtime readiness gate.

## Tests

Add focused regression coverage in `tests/library-fetch-runs.test.ts` for:

- The observed `state-migrations` preamble followed by a pretty-printed OpenClaw
  envelope whose payload text contains an escaped readiness object.
- Existing direct and wrapped JSON success shapes.
- Decorated output with `runtimeReady: false`.
- Fields split across different objects.
- Truncated JSON and diagnostic-only text.

Run shell syntax validation, the focused library-fetch test file, lint for the
modified test, and the broader test suite if the focused checks pass.

## Acceptance Criteria

- The observed decorated OpenClaw response passes preflight.
- Invalid or ambiguous readiness evidence still returns failure and preserves
  exit 78 behavior.
- No behavior changes occur outside OpenClaw library preflight detection.
