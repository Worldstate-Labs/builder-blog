# Agent Prompt Short Links

## Problem

FollowBrief currently copies Local Agent instructions in this form:

```text
Read https://followbrief.com/api/skill/jobs/<job>/skill.md?ec=<exchange-code>&runtime=... and follow the instructions.
```

Codex, Claude, Hermes, and OpenClaw may route that instruction through a web-reader safety layer. A URL containing an exchange code and several query parameters can be classified as a signed or unsafe URL, so the runtime either refuses to read it or spends time switching to a direct shell fetch. The exchange code, job, and mutable render options also appear in URL query logs.

## Goal

Every Copy prompt action must return a clean, opaque, ten-minute URL:

```text
https://followbrief.com/p/<opaque-token>
```

Opening that URL must directly return the same rendered Markdown prompt as the current job route, including the one-time exchange step. It must not redirect to a query-string URL. Existing exchange-code redemption remains single-use and is the only action that reveals the agent token.

This applies to one-time, recurring, stop, cloud worker host, and cloud worker stop prompts across all supported runtimes.

## Non-goals

- Human-readable or guessable short codes.
- A general-purpose URL shortener.
- Removing exchange-code authentication.
- Changing agent-token encryption, runtime behavior, job prompt contents, or schedule semantics.
- Supporting arbitrary redirect destinations or arbitrary stored query parameters.

## Design

### Data model

Add a dedicated `AgentPromptLink` model rather than mixing prompt-delivery state into `ExchangeCode`:

| Field | Purpose |
| --- | --- |
| `id` | Internal primary key. |
| `tokenHash` | Unique SHA-256 hash of the opaque URL token; the raw token is never persisted. |
| `exchangeCodeId` | Unique relation to the existing `ExchangeCode`, cascading on deletion. |
| `job` | Whitelisted `SkillJobName`. |
| `options` | Server-created JSON containing only supported prompt render options. |
| `expiresAt` | Same expiry as the related exchange code. |
| `createdAt` | Audit and cleanup timestamp. |

Each copied prompt creates one exchange code and one prompt link in a single transaction. The opaque token uses at least 128 bits of cryptographic randomness. The API returns the raw token once as part of the short URL; only its hash is stored.

The link is not marked consumed when its Markdown is read. Security scanners and agent readers may issue repeated GET or HEAD requests. The linked exchange code remains the authoritative single-use credential and is deleted during successful exchange; cascading deletion removes the prompt link at the same time.

### Prompt-link creation API

Replace the client-side “create exchange code, then assemble a job URL” contract with `POST /api/settings/tokens/[tokenId]/prompt-links`. The selected access key remains in the authenticated path, matching the current exchange-code endpoint; it must not be accepted from the request body. The endpoint accepts:

```json
{
  "job": "library-once",
  "options": {
    "runtime": "codex",
    "frequency": "daily",
    "force": false,
    "fetchDays": 30,
    "parallelWorkers": 10
  }
}
```

The endpoint must:

1. Confirm the selected agent token belongs to the signed-in user and is not revoked.
2. Validate `job` against `jobSkillFiles`.
3. Validate and normalize options with the same closed sets and numeric bounds used by prompt rendering.
4. Reject options that do not apply to the selected job rather than persisting arbitrary data.
5. Create the exchange code and hashed prompt-link record atomically with one ten-minute expiry.
6. Return `{ url, expiresAt }`, where `url` is same-origin `/p/<opaque-token>`.

The UI must copy only `Open <short-url> and follow the instructions.` It no longer receives or handles the exchange code.

Only these option groups are accepted:

| Job family | Accepted options |
| --- | --- |
| `library-once`, `digest-once` | `runtime`, `force`, `fetchDays` for library only, and `parallelWorkers` |
| `library-cron-setup`, `digest-cron-setup` | `runtime`, `frequency`, `force`, `fetchDays` for library only, and `parallelWorkers` |
| `library-cron-stop`, `digest-cron-stop` | No render options |
| `cloud-library-cron-setup` | `runtime`, `fetchDays`, and `parallelWorkers` |
| `cloud-library-cron-stop` | `runtime` only |

Internal jobs that are not exposed by either Copy prompt UI are rejected by this endpoint even if they exist in `jobSkillFiles`. Unknown keys and options outside the selected row return `400`.

### Short-link read route

Add `GET /p/[token]` as a public, read-only route. It must:

1. Validate the token format before querying.
2. Hash the token and load the prompt link, exchange code, agent token, and account.
3. Return a uniform `404` plain-text response for missing, expired, redeemed, or revoked records: `This FollowBrief prompt link is invalid or expired. Return to FollowBrief and copy a new prompt.`
4. Revalidate the stored job and options defensively.
5. Call shared prompt-rendering code directly with the resolved exchange code and typed render options.
6. Return Markdown without any HTTP redirect.

`HEAD /p/[token]` is required. It performs the same validation and returns the same status and privacy headers as GET, but never renders or returns the prompt body. Neither GET nor HEAD consumes the exchange code.

Responses use:

```text
Content-Type: text/markdown; charset=utf-8
Cache-Control: no-store, private
Referrer-Policy: no-referrer
X-Robots-Tag: noindex, nofollow, noarchive
```

The same cache, referrer, and robot headers apply to successful and failed GET/HEAD responses. Invalid-link responses use `Content-Type: text/plain; charset=utf-8`; successful GET responses use Markdown.

### Shared rendering boundary

Extract the current job route’s rendering inputs into a typed structure. Both the legacy job route and the short-link route call the same renderer, so account substitution, source credential preparation, OpenClaw child setup, runtime selection, frequency, lookback, force, and parallel-worker behavior cannot drift.

The renderer accepts only:

- a whitelisted `SkillJobName`;
- a validated exchange code or the existing unauthenticated child-setup context;
- normalized typed options;
- request origin/context needed to generate same-origin child URLs.

The public legacy `/api/skill/jobs/[job]/skill.md?...` route remains temporarily functional for already-copied ten-minute links and internal OpenClaw child setup. New UI copy flows must not generate it. The short-link route must never implement its behavior through an HTTP redirect.

### OpenClaw child setup

The first short-link read can still generate the existing OpenClaw parent prompt. Any child continuation URL created inside that prompt remains server-generated and must not depend on the prompt-link token after exchange. The current `openclaw_setup_child` behavior and its account validation remain unchanged during this migration.

## Security properties

- The opaque path token is a bearer capability even though it no longer resembles a signed query. Treat it as secret and never log its raw value in application logs.
- Store only `SHA-256(rawToken)` and compare through an indexed exact lookup.
- Use at least 128 bits of randomness and a fixed URL-safe token format.
- Keep the ten-minute expiry and uniform error responses.
- Do not redirect, cache, index, or send a referrer from the short-link response.
- Do not accept destination URLs, file paths, prompt bodies, or unknown option keys from the client.
- Exchange remains rate-limited and atomic. A successful exchange deletes both the exchange code and its linked short URL through cascade.
- Expired rows may be deleted opportunistically, but cleanup is not required for correctness.

## Failure behavior

| Failure | Response/behavior |
| --- | --- |
| Invalid token shape | Uniform `404` plain-text invalid/expired response with privacy headers. |
| Missing, expired, redeemed, or revoked link | The identical `404` response without revealing which state occurred. |
| Invalid job or options at creation | Authenticated `400` response; create neither row. |
| Database failure during creation | Transaction rolls back both records; UI reports that it could not prepare the prompt. |
| Clipboard failure | Existing manual-copy fallback displays the short instruction. |
| Repeated GET or reader preflight | Return the prompt while valid; do not consume it. |
| Exchange succeeds | Agent token is returned once; exchange code and prompt link are deleted atomically. |

## UI changes

`SkillPromptActions` and `AdminCloudFetchRunActions` send the selected job and typed options to the creation endpoint and copy the returned short URL. Their visible controls and ten-minute status text remain unchanged. Manual-copy fallback shows the same short instruction.

No new settings, labels, or explanatory UI are required.

## Testing

1. Model/migration contract: hash uniqueness, one-to-one exchange relation, and cascade deletion.
2. Creation endpoint: auth/ownership/revocation checks, option validation, raw token returned once, hash stored, atomic record creation, ten-minute aligned expiry.
3. Short route: valid Markdown response, no redirect, required privacy headers, uniform invalid/expired/revoked behavior, repeated GET support, and no raw token in persisted data.
4. Exchange integration: successful exchange invalidates the short link through cascade; concurrent exchange behavior remains single-use.
5. Renderer parity: the same job/options produce the same prompt body through the legacy and short-link entry points.
6. UI contracts: every copy surface requests a prompt link and copies `/p/<token>`; none assembles `?ec=` or `Read <signed-url>`.
7. Regression suites for one-time, recurring, stop, worker host, and each runtime continue to pass.

## Rollout and compatibility

Deploy the migration, creation API, and short route in the same release as the two UI updates. Existing query-based links continue to work for their remaining ten-minute lifetime. No backfill is needed. If rollout must be reverted, old links remain supported and new short links expire naturally after ten minutes.
