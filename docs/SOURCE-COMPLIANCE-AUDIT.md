# FollowBrief source compliance audit

Date: 2026-06-19

Scope: the current FollowBrief source model and local-agent fetch workflow in this
repo. This is an engineering compliance audit, not legal advice. Treat anything
that depends on copyright fair use, paid/commercial API rights, or provider
approval as requiring counsel or provider approval before launch.

## Sources in scope

`config/sources.json` currently defines seven source types:

| Source type | Current acquisition path | Risk |
| --- | --- | --- |
| `x` | X API v2 with `X_BEARER_TOKEN`; stores post text and raw tweet JSON. | Medium |
| `blog` | RSS/Atom or HTML page fetch; extracts full article body. | Medium |
| `github_trending` | Fetches and parses `github.com/trending`, then asks an agent to inspect repos and supporting web evidence. | Medium |
| `product_hunt_top_products` | Fetches and parses Product Hunt HTML, then asks an agent to open product pages. | High |
| `youtube` | YouTube RSS/channel page discovery plus captions, `youtube-transcript-api`, and local audio ASR via `yt-dlp`/`ffmpeg`. | Critical |
| `podcast` | RSS feed, Apple iTunes lookup for Apple pages, show notes, and audio transcription fallback. | High |
| `website` | Direct HTML fetch and full-page/article extraction. | Medium |

Important repo evidence:

- `src/lib/source-config-seed.ts` allows agents to use `yt-dlp`, `ffmpeg`,
  headless browsers, and transcription APIs as general fetch methods.
- `scripts/builder-digest.mjs` persists YouTube transcripts, blog bodies,
  podcast show notes/transcripts, website bodies, and X tweet objects into
  sync payloads.
- `src/app/api/skill/builders/route.ts` stores `FeedItem.body` and `rawJson`
  indefinitely unless the user deletes the account.
- `scripts/builder-digest.mjs` supports arbitrary
  `BUILDER_BLOG_FETCHER_*` / `BUILDER_BLOG_FETCHER_COMMAND` external fetchers,
  which can bypass provider-specific controls.

## Official terms reviewed

- X Developer Policy, Restricted Uses, Developer Guidelines, and Display
  Requirements.
- YouTube Terms of Service and YouTube API Services Developer Policies.
- Product Hunt Terms of Service and Product Hunt API 2.0 docs.
- GitHub Terms of Service, Acceptable Use Policies, and REST API docs.
- Apple iTunes Search API docs, Apple Media Services terms, and Apple Podcasts
  RSS requirements.
- RSS 2.0 specification, RFC 9309 Robots Exclusion Protocol, Google robots
  meta / X-Robots-Tag guidance, and U.S. Copyright Office fair-use guidance.

## P0 findings

### P0-1: YouTube transcript/audio fetching is not acceptable as currently built

Current behavior:

- The app discovers videos from YouTube RSS/channel pages, then fetches primary
  content through `yt-dlp` caption metadata, direct caption-track URLs,
  `youtube-transcript-api`, and local ASR by downloading audio.
- The full transcript is sent as `item.body` and persisted.

Compliance issue:

- YouTube Terms restrict downloading, reproducing, scraping, or automated access
  except through YouTube-provided features, public-search robots allowances, or
  prior written permission.
- YouTube API Policies separately prohibit scraping YouTube applications,
  prohibit downloading/caching/storing audiovisual content without approval, and
  require API Data storage/deletion/refresh controls.

Required remodel:

- Disable `yt-dlp`, `youtube-transcript-api`, watch-page caption scraping, and
  audio ASR for YouTube unless FollowBrief has explicit YouTube permission or a
  compliant API path.
- Treat YouTube as metadata/link-only by default: channel/video title, published
  date, URL, and embedded-player link are acceptable only through supported
  surfaces.
- Allow full transcript ingestion only when the user supplies a transcript they
  have rights to use, or the creator/owner authorizes it.
- If YouTube Data API is added, implement API credentials, privacy disclosure,
  Google security-settings revocation handling, 30-day refresh/delete rules,
  YouTube attribution, and delete-user-data controls.

### P0-2: Product Hunt HTML scraping conflicts with Product Hunt terms

Current behavior:

- The app fetches `https://www.producthunt.com/`, parses product links/counts
  from HTML, and sends agents to Product Hunt product pages.

Compliance issue:

- Product Hunt's terms prohibit crawling, scraping, spidering, and copying or
  storing significant portions of Product Hunt content.
- Product Hunt provides a GraphQL API, but its docs say API access requires a
  token, may be rate limited, asks for attribution, and is not for commercial use
  by default without contacting Product Hunt.

Required remodel:

- Stop the HTML fetch/parser path for Product Hunt.
- Replace it with the official Product Hunt API only after a Product Hunt token
  and commercial-use approval are in place.
- Until approval exists, remove Product Hunt from default fixed sources or show
  it as unavailable with a plain setup reason.
- Store only minimal metadata returned by the API and link back to Product Hunt
  with visible attribution.

### P0-3: Full source bodies/transcripts are retained too broadly

Current behavior:

- The sync route stores `body`, `summary`, URL metadata, and serialized
  `rawJson` for each item.
- This includes full blog/website article extracts, podcast show notes or
  transcripts, YouTube transcripts, and raw X tweet JSON.

Compliance issue:

- Platform terms and copyright analysis are much safer when FollowBrief stores
  summaries, citations, and short excerpts rather than full third-party works.
- RSS availability does not itself grant broad rights to retain, republish, or
  share full content. U.S. Copyright Office guidance is fact-specific; there is
  no fixed safe percentage.

Required remodel:

- Add per-source storage policy:
  `store_raw_body=false` by default for third-party content after summarization,
  `raw_retention_days` for temporary processing, and `raw_excerpt_max_chars`.
- Keep durable fields to title, URL, source, published date, summary, short
  excerpt, and structured metadata.
- Keep raw body/transcript only temporarily for private processing, with a
  deletion job and audit log.
- For Hub, never publish raw source bodies, full transcripts, full show notes,
  raw tweet JSON, Product Hunt comments, or source screenshots.

### P0-4: External fetcher hooks bypass compliance controls

Current behavior:

- `BUILDER_BLOG_FETCHER_{SOURCE}` and `BUILDER_BLOG_FETCHER_COMMAND` can return
  arbitrary items for any source type.

Compliance issue:

- A custom command can scrape YouTube/Product Hunt/websites or persist full
  source content without the app knowing which method was used.

Required remodel:

- Disable external fetchers by default in production.
- If retained for local development, require an explicit
  `ALLOW_UNSAFE_EXTERNAL_FETCHERS=1` flag and mark all output as local-only.
- Require every item to include `rawJson.acquisition.method`,
  `rawJson.acquisition.provider`, and `rawJson.acquisition.rightsBasis`; reject
  methods that the source compliance profile does not allow.

## P1 findings

### P1-1: X API usage needs display, refresh, and redistribution controls

Current behavior:

- X uses official API v2, which is the right direction.
- It stores post text in `body` and the raw tweet object in `rawJson`.
- The app summarizes posts rather than rendering fully compliant X post cards.

Compliance issue:

- X requires approved API use cases, rate/redistribution limits, privacy
  controls, and proper display if X content is shown.
- X recommends sharing IDs for rehydration instead of public hydrated-content
  redistribution.
- Display requirements say post text should not be modified when displaying the
  post itself; summaries must be clearly treated as FollowBrief summaries, not
  as reproduced X posts.

Required remodel:

- Stop storing raw tweet JSON; retain post ID, author ID/handle, URL, created
  date, summary, and a short private excerpt only if needed.
- Add a periodic rehydrate/delete check for X items and delete or hide content
  that is deleted, protected, unavailable, or no longer permitted.
- Ensure any raw X post display uses X embed or X display requirements. Digest
  summaries should be labeled as summaries and link to X.
- Prevent public Hub redistribution of hydrated X content; Hub can share source
  links/IDs and FollowBrief-authored summaries only.

### P1-2: Blog and Website need robots, no-paywall, and rights gates

Current behavior:

- Blog and website fetchers request public HTML and extract full article/page
  text without checking robots.txt, robots meta tags, X-Robots-Tag, or site terms.

Compliance issue:

- RFC 9309 defines robots.txt as the standard crawl control signal. It is not a
  legal authorization layer, but ignoring it is poor crawler behavior.
- Google documents robots meta / X-Robots-Tag controls such as `nosnippet` and
  `max-snippet`; those signals are useful publisher intent even outside search.
- Site-specific terms and copyright still control reuse.

Required remodel:

- Add a fetch gate that checks robots.txt before fetching article/page bodies.
- Parse robots meta and X-Robots-Tag. Respect `nosnippet`, `max-snippet:0`,
  `noai`, and analogous publisher controls as a no-summary/no-storage signal.
- Reject logged-in, private, paywalled, or access-controlled URLs unless the user
  documents rights to process the content.
- Add source-add UI copy: "Only add sources you have permission to fetch and
  summarize; do not add private, paywalled, or ToS-prohibited pages."

### P1-3: Podcast audio transcription needs rights and retention controls

Current behavior:

- Podcast RSS show notes are used when substantial. Thin show notes fall back to
  downloading/transcribing the audio enclosure.
- Apple Podcasts URLs are resolved through iTunes lookup to the publisher RSS
  feed.

Compliance issue:

- Apple lookup can help find podcast catalog/feed metadata; it does not grant
  rights to copy, transcribe, retain, or redistribute the podcast episode.
- Podcast audio and transcripts are copyrighted works unless the publisher
  grants broader rights.

Required remodel:

- Keep RSS show notes as the default body, with the raw-retention policy above.
- For full audio transcription, require an explicit user attestation that the
  user has rights to transcribe the show, or make transcription local-only and
  delete the raw transcript after summary generation.
- Never Hub-share full podcast transcripts or large show-note blocks.
- Store attribution to the RSS feed, episode page, and publisher.

### P1-4: GitHub Trending should avoid fragile HTML scraping and raw repo reuse

Current behavior:

- The app scrapes GitHub Trending HTML for repo candidates, then asks agents to
  inspect README, files, releases, commits, and external buzz.

Compliance issue:

- GitHub public repository content is viewable, but users retain content rights;
  public repos allow viewing/forking through GitHub functionality and may grant
  more rights only through repository licenses.
- GitHub API use is rate-limited; acceptable use also covers IP, privacy, site
  access, and excessive bandwidth.

Required remodel:

- Prefer GitHub REST API for repository metadata, README, releases, and commits.
- Keep Trending-page HTML parsing minimal and conservative if no official
  Trending API exists: low rate, clear user agent, no bulk crawling, no raw
  README/code persistence.
- Store repo URL, license metadata, facts, and FollowBrief summary. Do not store
  full README/code beyond temporary processing.

### P1-5: Terms and Privacy need source-specific disclosures

Current behavior:

- Public Terms/Privacy mention third-party sources/APIs, AI summarization, Hub,
  account export/delete, and platform terms.

Gap:

- They do not yet disclose source-specific handling for YouTube API data,
  Product Hunt API/commercial approval, X API content rehydration/deletion,
  raw-body retention, robots controls, user source-rights responsibility, or
  takedown/source-owner requests.

Required remodel:

- Add a source-processing section to Terms and Privacy.
- If YouTube API is used, add the Google security permissions link and explain
  revocation/deletion behavior.
- Add a takedown/contact path for source owners.
- Add a clear rule that users must not add sources where automated fetching,
  summarization, retention, or sharing violates the source's terms.

## P2 hardening

- Add `sourceComplianceProfile` data for every source:
  allowed acquisition methods, disallowed methods, API credential requirement,
  attribution text, raw retention, public sharing limits, revocation/delete
  requirement, robots requirement, and review date.
- Add a compliance gate in the sync route that rejects payloads whose
  acquisition method is not allowed for the source type.
- Add crawler politeness: rate limits per host, retry/backoff, robots cache, and
  clear `User-Agent` with contact URL.
- Add export/delete coverage tests proving raw third-party bodies are deleted or
  minimized.
- Add admin UI warnings when enabling high-risk source types.
- Add a scheduled provider-terms review checklist; terms reviewed here are
  current as of 2026-06-19 and can change.

## Implementation order

1. P0 code gate: introduce source compliance profiles and enforce them in the
   CLI fetcher and sync route.
2. P0 disable paths: remove YouTube transcript/audio extraction and Product Hunt
   HTML scraping from default runs until compliant provider/API paths exist.
3. P0 storage minimization: split raw processing content from durable feed item
   records, add retention/deletion job, and scrub `rawJson`.
4. P1 source UX: add user source-rights acknowledgement, robots checks, and
   source owner takedown/contact wording.
5. P1 provider-specific integrations: X rehydrate/delete, Product Hunt API with
   approval, optional YouTube Data API with revocation controls, GitHub REST API
   migration.

## Verification requirements

- Unit tests for every compliance profile: disallowed method rejected, allowed
  method accepted.
- CLI tests proving Product Hunt HTML and YouTube transcript/audio methods do
  not run unless explicitly enabled by a compliant profile.
- Sync-route tests proving raw body retention policy is enforced and Hub cannot
  publish raw third-party content.
- Browser/UI tests for source-add warnings and Terms/Privacy source-processing
  copy.
- Manual review of official provider terms before enabling any source marked
  high or critical risk.

## Source links

- X Developer Policy: https://docs.x.com/developer-terms/policy
- X Restricted Uses: https://docs.x.com/developer-terms/restricted-use-cases
- X Display Requirements: https://docs.x.com/developer-terms/display-requirements
- YouTube Terms: https://www.youtube.com/t/terms
- YouTube API Policies: https://developers.google.com/youtube/terms/developer-policies
- Product Hunt Terms: https://www.producthunt.com/legal
- Product Hunt API docs: https://api.producthunt.com/v2/docs
- GitHub Terms: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- GitHub Acceptable Use: https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies
- GitHub REST API docs: https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api
- Apple iTunes Search API: https://performance-partners.apple.com/search-api
- Apple Media Services Terms: https://www.apple.com/legal/internet-services/itunes/
- Apple Podcasts RSS requirements: https://podcasters.apple.com/support/823-podcast-requirements
- RSS 2.0 specification: https://www.rssboard.org/rss-specification
- RFC 9309 Robots Exclusion Protocol: https://datatracker.ietf.org/doc/html/rfc9309
- Google robots meta / X-Robots-Tag docs: https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- U.S. Copyright Office Fair Use Index: https://www.copyright.gov/fair-use/
