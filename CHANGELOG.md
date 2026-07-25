# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Changed

- **Breaking:** `JobResult.jobId` renamed to `sourceJobId`.
- **Breaking:** `JobResult.description` renamed to `descriptionText`.

### Added

- `JobResult.sourceUrl` — the job's canonical URL, scraped from the list item's own link (`a.base-card__full-link`'s `href`) at the same point `sourceJobId` is read, before the card is clicked. LinkedIn's guest search re-renders the detail pane client-side on click rather than navigating, so `page.url()` cannot be used for this. Because it's captured before the click, it survives a later click/detail-pane failure — it's `null` only for `'skipped'` results or a `'failed'` result whose error happened before the job's identity could be read.
- `JobResult.sourceHostname` — `sourceUrl`'s hostname (e.g. `de.linkedin.com`). LinkedIn assigns individual job postings to country-specific subdomains, so this can differ across jobs within the same run.
- `JobResult.scrapedAt` — an ISO-8601 timestamp (`new Date().toISOString()`) marking when each job's result was finalized. Always set, including for `'skipped'`/`'failed'` results.
- `JOB_LINK_SELECTOR` exported from `src/selectors.ts` (`.base-card__full-link`), the selector `sourceUrl` is read from.
