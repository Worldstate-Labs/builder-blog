# AI Person Candidate Expansion Design

## Goal

Audit the 12 high-signal AI people approved by the user and add only the
production-equivalent audit passes to FollowBrief's curated AI candidate library.

## Scope

The audit batch contains these exact X accounts:

- Jensen Huang (`JensenHuang`)
- Sam Altman (`sama`)
- Geoffrey Hinton (`geoffreyhinton`)
- Yoshua Bengio (`Yoshua_Bengio`)
- Mira Murati (`miramurati`)
- Mustafa Suleyman (`mustafasuleyman`)
- Greg Brockman (`gdb`)
- Aravind Srinivas (`AravSrinivas`)
- Jeff Dean (`JeffDean`)
- Clément Delangue (`ClementDelangue`)
- Aidan Gomez (`aidangomez`)
- Chip Huyen (`chipro`)

The previously suggested second-tier names are intentionally excluded until a
separate review establishes their current activity and exact official handles.

## Approach

Keep the July 27 audit immutable and introduce a separate July 28 incremental
proposal set and sanitized audit report. Reuse the existing production audit
runner programmatically so every account is checked through the same resolver,
source probe, X API fetcher, 90-day recency cutoff, exact-handle comparison, and
safe downloadable icon validation as the original batch.

The curated library remains the union of all accepted reviewed batches. A
temporary failure while re-fetching an old source must not remove a previously
accepted entry, so the new audit runs only against the 12 new accounts.

## Acceptance Rules

An account is eligible only when all of the following are true:

1. The configured X bearer token is positively accepted.
2. The X API resolves the requested handle exactly, case-insensitively.
3. At least one retrievable post is dated within the 90 days preceding the
   audit runner's actual execution time.
4. The X profile supplies a safe icon URL and that icon downloads successfully.
5. Its canonical source key does not duplicate any existing curated candidate.

Failed accounts remain in the audit report with their exact rejection reason and
are not added to the curated manifest. The pass criteria will not be weakened to
increase the accepted count.

## Data and Code Boundaries

- `src/lib/ai-source-candidate-review.ts` owns the new 12-entry proposal batch.
- `scripts/audit-ai-source-candidates.ts` remains the shared network auditor; its
  existing injectable `proposals` option is used without adding another CLI.
- `docs/superpowers/reports/2026-07-28-ai-person-candidate-audit.json` stores only
  sanitized evidence for the incremental batch. Sanitized evidence contains
  only non-sensitive proposal, decision, HTTP status, fetch-count, handle, and
  icon metadata—never credentials, headers, response bodies, data URLs, database
  URLs, or local filesystem paths.
- `src/lib/source-candidate-library.ts` receives only accepted records, using the
  exact audited URL, handle, and icon.
- `tests/ai-source-candidate-review.test.ts` locks the proposal batch, report
  completeness, accepted-manifest correspondence, and cross-library canonical
  uniqueness.

## Verification

Follow a red-green cycle for the new proposal and report contracts. After the
real audit, manually compare every accepted manifest record with its evidence,
then run the focused source-candidate tests, the full test suite, lint, type
checking, and the production build. Do not sync the production database as part
of this task; normal application seeding will publish the code-reviewed manifest.

## Safety

Never print or commit the X bearer token. If production environment variables
must be pulled, store them in a temporary file outside the repository and delete
the file after the audit even if the audit fails. Preserve all unrelated
untracked workspace files.
