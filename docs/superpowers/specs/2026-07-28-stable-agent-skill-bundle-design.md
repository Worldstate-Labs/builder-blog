# Stable Agent Skill Bundle Design

## Problem

FollowBrief currently installs fourteen runtime files with fourteen separate
Node processes and network connections. A transient proxy or TLS connection
failure late in that sequence aborts the whole setup after earlier files have
already been replaced. The wrapper also hides `fetch`'s nested cause, so a
connect timeout is reported only as `fetch failed`.

This affects every copied prompt because one-time Fetch, recurring Fetch,
AI Brief, Cloud Fetch setup, and all stop operations share the same bootstrap
step. Recurring runners repeat the same per-file refresh pattern.

## Chosen architecture

Expose one public, cacheable JSON bundle containing the complete allowlisted
agent runtime. Each entry has a safe agent-relative target, mode, base64
content, and SHA-256 digest. The bundle has a deterministic manifest digest.
The existing single-file endpoints remain for backward compatibility and the
one-file runner self-update path.

A dependency-free CommonJS installer is the single implementation for bundle
download, validation, staging, rollback, and diagnostics. The bootstrap route
embeds that exact installer source so a new machine needs only the bootstrap
request and one bundle request. The installed runner invokes the installed
copy for refreshes; an upgraded legacy runner downloads the installer once if
it is not present.

## Server components

- A shared file catalog owns download names, repository paths, installed
  targets, content types, and executable modes.
- The existing file route reads through that catalog.
- The bundle route reads the same rendered content, computes per-file hashes
  and a deterministic bundle id, and returns it with CDN cache headers.
- The bootstrap route embeds the installer source and invokes it against the
  bundle endpoint.
- Output tracing and the build-time manifest verifier cover the bundle,
  bootstrap installer source, scripts, configs, and every job prompt.

## Client behavior

The installer:

1. Downloads the bundle in one Node process.
2. Retries network errors and HTTP 408, 429, and 5xx up to four attempts with
   bounded exponential backoff.
3. Reports the nested error code/cause, attempt count, and elapsed time.
4. Rejects malformed schemas, unsafe or duplicate paths, missing required
   runtime files, invalid modes, bundle-id mismatches, and content-hash
   mismatches.
5. Writes every verified file under an agent-directory staging tree.
6. Replaces installed files only after the entire bundle validates and stages.
   If a local commit step fails, it restores prior files from same-filesystem
   backups and removes newly created files.

The shared copied-prompt bootstrap fetch and OpenClaw child-prompt fetch use
the same retry policy and preserve nested network causes. The runner keeps its
single-file self-update compatibility path but uses stronger retry diagnostics,
then refreshes the rest of the runtime through the bundle.

## Compatibility and scope

All user-facing Fetch, Digest, and Cloud Fetch setup/stop prompts already
include the shared install fragment, so they automatically use the bundle.
Regular personal Fetch and Digest runner behavior is unchanged after install.
The public single-file routes remain available for older installed runners.
No account files, tokens, logs, schedules, submissions, or fetched content are
part of the bundle or staging transaction.

## Verification

- Unit tests cover deterministic bundle construction and file hashes.
- Installer tests cover transient failures followed by success, non-retryable
  HTTP errors, nested-cause diagnostics, corrupt bundles, path traversal, and
  rollback without changing a prior installation.
- Contract tests prove bootstrap and runner refresh use the bundle and every
  exposed copied job retains the shared install step.
- Production build verification proves all runtime assets are present in the
  emitted route traces.
- A production-mode local server smoke test downloads and installs the bundle
  into an isolated temporary agent directory and compares every file.
