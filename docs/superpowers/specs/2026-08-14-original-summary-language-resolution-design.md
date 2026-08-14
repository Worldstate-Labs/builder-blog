# Original Summary Language Resolution Design

## Problem

FollowBrief currently overloads `summaryLanguage` with two incompatible meanings:

- a user request mode such as `source` (Original), and
- the concrete language in which a stored summary was written.

That ambiguity reaches the shared-post reuse path. When an Original-language run finds an English body with a Chinese Hub summary, the runner sees a stored summary language of `zh-CN` and a target of literal `source`. It creates a translation-only task whose prompt asks the worker to translate into `source`, while also forbidding the worker from using the body. The result is nondeterministic and may remain Chinese. Sync then persists `source` as though it were the summary's actual language, making future reuse decisions trust incorrect metadata.

The observed Andrej Karpathy case is:

```text
content language     C = en
stored summary       S = zh-CN
requested mode       R = source
current target           source   (invalid)
required target      T = en
```

The correct operation is to translate the existing Chinese summary into English. It must not fetch X again or summarize the body again.

## Goals

- Make Original a request mode, never a concrete content language.
- Persist the actual body language and actual summary language independently.
- Resolve a concrete target language before copying or translating a summary.
- Reuse an existing summary whenever its target can be resolved, without refetching or resummarizing.
- Apply the same rules to regular agent fetch and cloud fetch.
- Reject or quarantine language-inconsistent rows before they can poison future reuse.
- Migrate existing data without deleting valid fixed-language summaries.

## Non-Goals

- Do not change fetch schedules, leases, stop flows, source discovery, or admin-only source rules.
- Do not redesign AI Brief language selection.
- Do not add a new language-detection dependency.
- Do not require an immediate rewrite of every legacy `rawJson` payload.

## Language Semantics

The pipeline uses four distinct values:

| Value | Meaning | Example |
| --- | --- | --- |
| `requestedSummaryLanguage` | User-selected mode or fixed language | `source`, `zh`, `en` |
| `contentLanguage` | Actual language of the retained primary body | `en` |
| `summaryContentLanguage` | Actual language of the stored summary | `zh-CN` |
| `resolvedTargetLanguage` | Concrete language required for this operation | `en` |

Target resolution is the invariant:

```text
requestedSummaryLanguage = source  => resolvedTargetLanguage = contentLanguage
requestedSummaryLanguage = fixed   => resolvedTargetLanguage = requestedSummaryLanguage
```

`contentLanguage` and `summaryContentLanguage` use normalized BCP-47 language tags. They may be null when unknown, but may never contain request aliases such as `source`, `original`, or `Original content language`.

Actual-language comparison is stricter than preference alias comparison. For example, a fixed `zh` preference may accept a supported Chinese variant, while an Original body known to be `zh-Hant` should not silently accept a `zh-Hans` summary.

## Data Model

Add nullable first-class fields to `FeedItem`:

```prisma
contentLanguage        String?
summaryContentLanguage String?

@@index([canonicalPostId, summaryContentLanguage])
```

Nullable fields permit a zero-downtime migration and preserve legacy rows whose language cannot be established safely.

Existing task, library, and preference fields named `summaryLanguage` continue to represent the requested mode. Internal code should rename local variables to `requestedSummaryLanguage` where practical, without requiring a broad database rename.

New `rawJson` writes preserve provenance only:

```json
{
  "requestedSummaryLanguage": "source",
  "languageResolution": {
    "content": "provider_metadata",
    "summary": "agent_output"
  }
}
```

Legacy `rawJson.summaryLanguage` remains readable during rollout. It is never accepted as an actual language when its value is an Original alias, and new writes stop creating that ambiguity.

## Language Resolution

`resolveContentLanguage` resolves the body language in this trust order:

1. Explicit normalized language emitted by the extractor or provider.
2. Existing `FeedItem.contentLanguage` from the same canonical post.
3. Trusted feed, HTML, transcript, or platform language metadata.
4. High-confidence deterministic detection from retained body text.
5. Worker classification from a bounded body excerpt during the same translation operation.

The deterministic detector reuses the repository's existing script-family logic for Han, Kana, Hangul, and Latin text. It can confidently reject obvious mismatches without pretending to distinguish every Latin-script language. When exact language remains uncertain, the worker returns the concrete BCP-47 language together with the translated result.

Summary language is resolved from explicit worker output, persisted first-class metadata, trusted fixed-language legacy metadata, and finally high-confidence text detection. A legacy value of `source` provides no evidence.

## Reuse State Machine

Let `C` be content language, `S` stored summary language, `R` requested language, and `T` resolved target.

| Available data | Decision |
| --- | --- |
| Valid summary and `S = T` | Copy summary and valid headline deterministically |
| Valid summary and `S != T` | Translate the existing summary into `T` |
| No valid summary, reusable body | Summarize the reused body in `T` |
| Summary, no body, but persisted `C` | Copy or translate using persisted `C` |
| Summary, no body, unknown `C`, and `R = source` | Decline summary reuse and run normal fetch |
| Neither summary nor body | Run normal fetch |

For Original with a reusable body but unresolved exact language, use a translation-to-content-language task. The worker may inspect the body only to identify its language; the source material for translation remains the existing summary.

## Shared-Post Reuse Contract

The reuse API becomes the single owner of the language decision. It returns a versioned `reusePlan` in addition to legacy response fields during transition:

```json
{
  "reusePlan": {
    "version": 2,
    "mode": "translate_summary_to_content_language",
    "requestedLanguage": "source",
    "contentLanguage": "en",
    "sourceSummaryLanguage": "zh-CN",
    "targetLanguage": "en"
  }
}
```

Supported modes are:

- `copy_summary`
- `translate_summary_fixed`
- `translate_summary_to_content_language`
- `summarize_reused_body`
- `none`

The API scores candidates by whether they can complete the requested operation safely: same-target summary first, translatable summary with known target second, reusable body third, and recency last. The runner consumes the plan instead of independently recomputing language equality.

## Runner Work

Fixed-language translation may continue using `translate_summary_only`. Add `translate_summary_to_content_language` for Original when the existing summary language differs from the body language or the body supplies the final language evidence.

The task carries:

```json
{
  "sourceSummary": "...",
  "sourceLanguage": "zh-CN",
  "contentLanguage": "en",
  "targetLanguage": "en"
}
```

No generated task may contain `targetLanguage: "source"`.

The new prompt contract states:

- Do not fetch the URL, download media, or regenerate a summary from the body.
- Translate only `sourceSummary`.
- Use body text only as bounded language evidence when the target was unresolved.
- Return `contentLanguage` and `summaryContentLanguage` as concrete normalized tags.
- Write the headline in the same language as the summary.

## Sync Contract

Extend `SkillFeedItemSchema` with optional `contentLanguage` and `summaryContentLanguage`. The sync boundary normalizes and validates both values before storage.

Validation rules:

- Concrete fields reject Original aliases.
- For a fixed request, `summaryContentLanguage` must match the fixed target.
- For Original, `summaryContentLanguage` must match `contentLanguage`.
- High-confidence script-family mismatches are rejected even when worker metadata claims a match.
- A mismatch returns `summary_language_mismatch` and does not write the item.

Compatibility behavior for older runners:

- For fixed requests, the server may infer the summary language from the requested fixed target.
- For Original, the server may infer concrete languages only from trusted metadata or retained text.
- If it cannot infer safely, it stores null and excludes the summary from deterministic Original reuse.

This makes rollout additive instead of breaking active cloud hosts or older local bundles.

## Historical Migration and Repair

1. Apply the nullable schema migration.
2. Backfill content language from provider metadata, existing trustworthy metadata, and high-confidence body detection.
3. Backfill summary language from explicit fixed-language metadata only when it agrees with detectable text; never copy legacy `source` into a concrete field.
4. Leave ambiguous fields null and report them for review.
5. Immediately exclude Original rows whose known summary language differs from their known content language.
6. Generate one-time translation repair tasks for those mismatches, using the stored summary and content language without network fetches.

The Andrej rows become `contentLanguage=en`, `summaryContentLanguage=zh-CN`, are quarantined from Original reuse, and are repaired by translating the stored summaries to English. Valid Chinese summaries in fixed Chinese user or platform libraries remain untouched.

## Rollout

1. Deploy the nullable migration.
2. Deploy dual-read, new-write language metadata and sync validation.
3. Deploy reuse contract v2 and the updated runner bundle.
4. Run a dry-run backfill report, then the metadata backfill.
5. Run one-time repair tasks for known Original mismatches.
6. Verify regular and cloud production fetches.
7. After legacy adoption is sufficient, remove fallback reads that treat `rawJson.summaryLanguage` as concrete metadata.

At every stage, unknown metadata reduces reuse but cannot produce a wrongly localized summary.

## Observability

Fetch logs should record the decision without exposing body text:

```text
reuse=translate_summary_to_content_language requested=source content=en summary=zh-CN target=en
```

Track counters for copied summaries, fixed translations, Original translations, reused-body summaries, unknown language fallbacks, sync mismatches, and quarantined legacy rows.

## Testing

Table-driven language matrix coverage must include:

- `C=en, S=en, R=source` copies.
- `C=en, S=zh-CN, R=source` translates to English with no network fetch.
- `C=en, S=zh-CN, R=fr` translates to French.
- `C=zh-Hant, S=zh-Hans, R=source` does not copy as an exact Original match.
- Legacy `summaryLanguage=source` is never accepted as actual summary language.
- Body-only reuse summarizes without refetching.
- Summary-only Original reuse with unknown content language falls back to fetch.
- Sync rejects a Chinese summary claiming to be English.
- Regular and cloud fetch produce the same reuse plan and persisted language fields.

The primary acceptance case is:

```text
body=en + stored summary=zh-CN + requested=source
=> translate zh-CN to en
=> zero source network access
=> contentLanguage=en
=> summaryContentLanguage=en
```
