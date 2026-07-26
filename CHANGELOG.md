# Changelog

All notable changes to this project are documented in this file.

## v0.3.0

> `JobResult` gains two required properties, so any code constructing or
> spreading a `JobResult` literal must supply them. Every run now also visits
> LinkedIn company pages, which makes a scrape take meaningfully longer.

### Added

- `JobResult.companyAddresses` — the office addresses published on the hiring company's LinkedIn page, as `CompanyAddress[]`, **with the address LinkedIn tags "Primary" at index 0**. `[]` and `null` are distinct: `[]` means the page was read and the company publishes no address, `null` means no lookup happened or it failed. Roughly 30% of companies genuinely publish none.
- `JobResult.companyUrl` — the absolute, normalized URL of that company page, read from the card's company link (`h4.base-search-card__subtitle a`) during the same identity read as `sourceUrl`, so it survives a later click/detail-pane failure. This is also the key the run's address cache uses; the company *display name* is deliberately not used, since LinkedIn abbreviates it in the list ("Slalom" for `slalom-consulting`) in ways that collide between unrelated companies.
- `CompanyAddress` and `RawCompanyLocation` types. `CompanyAddress` is `{ streetAddress, city, postalCode, countryCode }`, all nullable. `postalCode` holds the region and postal code together (`'Hessen 60313'`, `'WA 98104'`) because LinkedIn renders them joined with a plain space and no separator that distinguishes them.
- `ScraperOptions.companyLookup` — `navigationTimeoutMs` (20000), `emptyRetries` (1), `delayBetweenLookupsMs` (900) and `maxAddressesPerCompany` (uncapped), all optional and defaulted in the engine like every other tuning constant.
- `src/address.ts`, exporting the pure parsers `parseLocalityLine`, `parseCompanyLocation` and `toCompanyAddresses`, so a stored company page can be re-parsed without re-scraping.
- `src/companyLookup.ts`, exporting `createCompanyLookup(browser, options)` and the `CompanyLookup` interface, usable on its own to resolve addresses for a list of company URLs.
- `normalizeCompanyUrl` exported from `src/url.ts`, and `LIST_COMPANY_LINK_SELECTOR`, `COMPANY_LOCATIONS_SECTION_SELECTOR`, `COMPANY_LOCATION_ITEM_SELECTOR` and `COMPANY_PRIMARY_TAG_SELECTOR` from `src/selectors.ts`.

### Changed

- `runScrape` now opens **two** browser contexts inside the browser it launches: one for the job search, one for company pages. The company context clears its cookies before every navigation, because LinkedIn only serves a company page's Locations section to a cookie jar that hasn't already seen one — reusing a context makes the second company onwards come back with the section silently absent, which is indistinguishable from a company with no address. Clearing cookies on the search context instead would discard the guest job session, hence the separate context.
- `ScrapeJobOptions` and `ScrapeContext` gain a required `companyLookup` property.
- `normalizeJobUrl` and `normalizeCompanyUrl` are now two names over one shared internal normalizer; `normalizeJobUrl`'s behavior is unchanged.

## v0.2.0

> **Breaking release.** `JobResult` renames two fields and gains a required
> property, and two exported signatures change. Consumers installing this as a
> git dependency should pin the `v0.2.0` tag rather than track a branch.

### Changed

- **Breaking:** `JobResult.jobId` renamed to `sourceJobId`.
- **Breaking:** `JobResult.description` renamed to `descriptionText`.
- **Breaking:** `JobResult.scrapedAt` is a **required** property, so any code constructing or spreading a `JobResult` literal must now supply it.
- **Breaking:** the internal `jobId` vocabulary was renamed to match the public field, which changes two exported signatures — `registerJobOccurrence(seenSourceJobIds, sourceJobId, index)`, and `ScrapeJobOptions.seenJobIds` → `ScrapeJobOptions.seenSourceJobIds` (likewise `ScrapeContext.seenSourceJobIds`).

### Added

- `JobResult.sourceUrl` — the absolute URL of the individual job posting (each job in the result list has its own; this is not the search URL), scraped from the list item's own link (`a.base-card__full-link`'s `href`) at the same point `sourceJobId` is read, before the card is clicked. LinkedIn's guest search re-renders the detail pane client-side on click rather than navigating, so `page.url()` cannot be used for this. Because it's captured before the click, it survives a later click/detail-pane failure. It is `null` whenever no usable URL could be read: `'skipped'` results, a `'failed'` result whose error preceded the identity read, a card with no link, or an href with no hostname — so a `'success'` result can still carry a `null` `sourceUrl`.
- `JobResult.sourceHostname` — `sourceUrl`'s hostname (e.g. `de.linkedin.com`). LinkedIn serves individual job postings from country-specific subdomains, so this can differ across jobs within the same run. `null` exactly when `sourceUrl` is `null`.
- `JobResult.scrapedAt` — an ISO-8601 timestamp (`new Date().toISOString()`) marking when each job's result was finalized. Always set, including for `'skipped'`/`'failed'` results.
- `JOB_LINK_SELECTOR` exported from `src/selectors.ts` (`.base-card__full-link`), the selector `sourceUrl` is read from.
- `normalizeJobUrl`, `hostnameOf` and `jobIdFromUrl` exported from `src/url.ts` — the pure functions behind `sourceUrl`/`sourceHostname`/`sourceJobId`, so consumers can re-derive those fields from a stored URL instead of trusting a persisted value.

### Fixed

- `sourceUrl` is now resolved against the search page URL. `getAttribute` returns the raw attribute rather than the resolved property, so a relative href — which LinkedIn's guest markup emits depending on locale/session — previously produced a non-absolute `sourceUrl` and a `null` `sourceHostname`.
- `sourceUrl` now has LinkedIn's per-session tracking query string (`refId`, `trackingId`, `position`, `pageNum`, `trk`) and any fragment stripped. Previously the same posting produced a different `sourceUrl` on every run, giving consumers that dedupe or upsert on it false-new rows, and persisting session tracking identifiers into their storage.
- `sourceHostname` returns `null` instead of an empty string for hrefs whose scheme carries no hostname. `new URL('javascript:void(0)')` parses without throwing and reports `hostname === ''`, so the previous try/catch let through a value that was neither `null` nor a hostname. Such hrefs now null out `sourceUrl` as well, restoring the documented "`null` exactly when `sourceUrl` is `null`" invariant.
- Both card attribute reads now pass an explicit `{ timeout: 1000 }`. They previously inherited Playwright's 30s default, and since `getAttribute` auto-waits for its element, one renamed or missing class cost ~30s per job — roughly an hour on a 120-job run, silently swallowed by the surrounding `.catch()`.
- The `data-entity-urn` read is now individually guarded. It previously had neither a timeout nor a `.catch()`, so a missing `.base-card` both stalled and threw away the rest of the identity — including the `sourceUrl` that is meant to survive a later failure.
- `sourceJobId` now falls back to the trailing posting ID in `sourceUrl` when `data-entity-urn` is unreadable. A null `sourceJobId` silently disables duplicate detection *and* makes `waitForJobDetailToLoad` skip its detail-pane wait, which is the condition that manufactures stale results.
- The four per-job identity reads now run concurrently instead of as four sequential round-trips.
