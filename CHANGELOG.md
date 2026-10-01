# Changelog

All notable changes to this project are documented in this file.

## v0.13.3

### Fixed

- Company-page lookups now check the navigation response before reading locations. Unsuccessful HTTP statuses (including 403, 429 and 500) and missing responses return `null` when every attempt fails, preserving the distinction from a successfully read page with no addresses (`[]`) in the run-wide cache (GitHub issue #42).
- Retries retain earlier successful empty reads and can still upgrade a failed lookup to populated addresses. Existing retry limits and budget-limited cache behavior are preserved.

### Validation

- Offline company-lookup regressions cover HTTP 403/429/500 and missing responses, successful empty pages, mixed retry outcomes, cached provenance, disabled retries, and an aborted job budget. Successful fake navigations explicitly return HTTP 200; no browser or live LinkedIn request is required.

## v0.13.2

### Fixed

- Initial search HTTP failures, missing responses and redirects away from the requested LinkedIn guest-search surface now reject before discovery instead of reporting a successful empty search (GitHub issue #41). Errors identify the HTTP status or destination without exposing redirect query parameters; normal browser cleanup is preserved.
- Caller cancellation and run-budget expiry during navigation retain their documented outcomes before the returned page is validated. Valid HTTP 200 zero-result searches, country subdomains and trailing-slash/query differences remain supported.

### Validation

- Offline public-API regressions cover HTTP 403/429/500, missing responses, authentication/challenge and unrelated destinations, successful empty searches, cleanup, and caller-abort/run-budget precedence. No browser or live LinkedIn request is required.

## v0.13.1

### Fixed

- `npm run build` now removes generated `dist/` output with a portable Node.js cleanup step before compiling. Updating a previously built checkout no longer leaves an obsolete `dist/scraper.js` shadowing the current `dist/scraper/index.js` implementation and its public exports (GitHub issue #44). Git-dependency `prepare` continues to use the same build path.

### Validation

- Offline regression coverage runs the actual build and prepare scripts in temporary package fixtures with obsolete scraper output, verifies the package main's current `runScrape` and `ScrapeAbortedError` exports, and checks fresh preparation when `dist/` does not exist. No browser is launched.

## v0.13.0

### Fixed

- Both loading phases now continue through overlapping batches containing only IDs already present in the rendered list. Stability requires neither raw-card nor unique-posting progress, allowing duplicate-only `start=25` and `start=50` responses to advance to later pagination that introduces new jobs (GitHub issue #39).
- `runScrape` now traverses the ordered first occurrence of each distinct posting instead of the first N raw DOM positions. Unique postings after duplicate rows are no longer missed, and parseable cards are re-located by `sourceJobId` before their first pass and optional retry.

### Changed

- `runScrape().results`, `jobs:found.total`, and job progress use contiguous logical indices over distinct posting IDs in first-list-occurrence order. `maxJobs` is applied after deduplication, and raw-only growth never emits an inflated `jobs:loading` count.
- Cards whose ID cannot be parsed remain separate logical entries so their existing identity failure stays visible. Exported `scrapeJob(page, index, options)` and `scrapeAllJobsOnce` retain their raw-index behavior, including `duplicateOfIdx`; ordinary `runScrape` results now normally have `duplicateOfIdx: null`.
- Existing options, event variants, selectors, function signatures, defaults, and public type shapes are unchanged. `maxScrollAttempts` and `maxSeeMoreClicks` remain the final bounds if LinkedIn appends duplicates indefinitely.
- The package version is `0.13.0`.

### Validation

- A live headless Playwright guest search for `Software Engineer` in Germany posted in the past month reproduced the exact overlap on 2026-09-09: the page began at 60 raw rows / 60 unique jobs, `start=25` reached 70 / 60, `start=50` reached 80 / 60, and `start=75` reached 90 / 70. Scrolling continued to 110 / 90; after a 429 at scroll `start=150`, the click phase successfully loaded `start=150`, `175`, and `200`, finishing at 140 / 120. Progress emitted only the truthful unique totals 60, 70, 80, 90, 100, 110, and 120. A traversal of the final mapping resolved all 120 distinct IDs exactly once with zero mismatches.
- The live probe stopped at its configured `maxSeeMoreClicks: 3` with the button still visible and no viewed-all banner. It proves progression and complete traversal of the 120 distinct cards loaded within that bound; it does not claim exhaustion of LinkedIn's guest results.
- Focused coverage includes duplicate-only growth followed by later unique growth in both loading phases, true exhaustion, raw-duplicate bounds, snapshot identity fallback, unique-card mapping beyond duplicate rows, contiguous logical indices, post-deduplication `maxJobs`, and mapped retries.
- The focused loader/mapping suite passes 19/19 tests and the full offline suite passes 251/251 tests.

## v0.12.0

### Fixed

- Stale LinkedIn detail panes are no longer emitted as successful results. A successful read now requires the rendered detail job ID to match the clicked card's source job ID; an unverified pane becomes an explicit failure eligible for the existing deferred retry. This completes GitHub issue #29.

### Added

- Exact detail-pane identity gating for GitHub issue #35. After each card activation, the title-link href is parsed and its complete job ID must equal the card's `sourceJobId` before company, description, tags, or other detail fields are read. A mismatch gets one immediate overlay-aware re-click within the existing job and run budgets.
- `FailedJobResult.failureReason: 'detail-pane-identity-unverified'` for a pane that still cannot prove its identity after recovery, plus ordered `StaleDiagnostics.detailIdentityChecks` and aggregate `StaleReport.identityRecovery` counters.

### Changed

- Persistent identity failures return `status: 'failed'` with detail fields `null`; stale predecessor data is never returned as a successful result. These failures keep the existing deferred single-retry opportunity, which may replace the failed first-pass slot if the settled page recovers.
- The existing 8s title-link and 5s network-idle caps, overlay policy, and deferred retry delay are unchanged. Network idle is only awaited after a candidate identity match, followed by one final exact identity check.
- The package version is `0.12.0`.

### Validation

- GitHub issue #36's live experiment reproduced the 0/90 single-browser baseline and completed three isolated 30/30/30 three-browser contention samples. The fix emitted 0 stale successes among 243 successful first-pass reads; the other 27 of 270 first-pass paths were explicit identity failures, and all 27 recovered on the deferred retry for 270/270 final successes.
- All 270 eligible contended detail reads captured their requested snapshots and complete overlay timelines, every successful rendered job ID matched its source job ID, and no run stopped early or produced a time-budget or unexplained failure.

## v0.11.0

### Added

- Trustworthy stale-result diagnostics for GitHub issue #29. Every considered list index carries a self-describing `StaleDiagnostics` record with `runId`, `totalJobs`, final `resultStatus`, list/detail identities, wait timings, a phase-by-phase overlay timeline, and an explicit DOM-snapshot outcome. Diagnostics remain enabled by default; DOM snapshots remain opt-in.
- `ScrapeOutcome.staleReport`, plus the pure `summarizeStaleDiagnostics` and `describeStaleReport` exports. Headline rates and condition correlations use successful first-pass jobs only, while retry attempts remain available in raw records and dedicated recovery counters. All eight flag combinations are reported, including zero-count combinations.
- `scripts/diagnose-stale.ts` for repeatable single-browser and concurrent live experiments. It writes collision-proof per-search artifacts and one combined JSON report; raw DOM output remains gitignored.

### Changed

- `OverlayClearResult` now reports whether an overlay was observed and whether its diagnostics read failed. Per-job diagnostics retain every pre-click, post-click, and late clear, including budget-skipped checks and diagnostics from overlays that were successfully dismissed.
- Records carry explicit run identity and total size, skipped jobs retain minimal records, and positional analysis uses exact preceding indices. Concatenated and out-of-order run records no longer rely on inferred array boundaries.
- The package version is `0.11.0`. This release is diagnostic-only: it does not change detail-pane waits, stale detection, or retry behavior, and it does not close issue #29.

## v0.10.0

### Added

- `ScraperOptions.perJobTimeoutMs` (default `45000`) — a wall-clock budget for one job's entire scrape (closes GitHub issue #28). Nothing bounded a single job before: every wait in the per-job path had its own local timeout, but they stack past 100 seconds, and a run scrapes every discovered job in sequence, so one systematically blocked click could make a 30-job run spend the better part of an hour producing nothing. It is enforced by clamping every individual Playwright wait below `scrapeJob` — the card scroll, the click ladder, the three overlay clears, the detail-pane wait, each field read, and the company-page lookup — to whatever is left of the budget, so it bounds *real elapsed* time rather than only being checked between steps. Deliberately not a race between the job and a timer: Playwright honours the timeouts it is handed, so clamping leaves no orphaned browser work running behind a promise that already resolved. A job that blows the budget is abandoned and recorded as `status: 'failed'` with `error: 'Job exceeded per-job time budget of <n>ms'`, carrying whatever identity was read off the list card first; it emits the usual `job:done`, keeps its slot in `results`, and is not retried. `0` or a negative value disables it, following Playwright's own "0 means no timeout" convention.
- `ScraperOptions.maxRunDurationMs` — an optional wall-clock budget for the whole run, browser startup included. No default: omitted, a run takes as long as its jobs take. Expressed internally as an `AbortSignal` composed with the caller's own rather than as a new parameter on every phase, so every checkpoint that already stops on `signal?.aborted` honours it for free. When it runs out, `runScrape` **resolves** with the results gathered so far — a budget the caller asked for is an expected outcome, not a failure — while a caller `signal` abort still rejects with `ScrapeAbortedError` and wins when both are true. `0`, a negative value, `Infinity` and `NaN` all mean "no run budget"; a fractional or out-of-range duration is rounded and capped rather than being allowed to reject the run with a raw `ERR_OUT_OF_RANGE` before the browser launches.
- `ScrapeOutcome.stoppedEarly` — `'run-time-budget'` when the run stopped short of scraping every job it found because `maxRunDurationMs` ran out, absent otherwise. Additive: a run that sets no run budget can never set it, so existing consumers are unaffected.
- New exports: `createJobBudget` and `createRunTimeBudget` (both pure factories over plain numbers and signals, unit-testable with no browser in the way, and needed by a consumer driving `scrapeJob` directly rather than through `runScrape`), plus the types `JobBudget` and `RunTimeBudget`.

### Changed

- **An abort now lands inside the in-flight job, not only between jobs.** `RunScrapeOptions.signal` is threaded into each job's budget and checked at its step boundaries, so cancelling a run takes effect within seconds instead of waiting out the ~100s a stuck job can take. `runScrape` still only rejects at its own safe checkpoints and still always closes the browser first. The interrupted job is recorded at its own index as `status: 'failed'` with `error: 'Scrape aborted'` and whatever identity it had read — an honest slot in `ScrapeAbortedError.partial.results` rather than a job that vanishes. Consumers that persist results should read that error as "interrupted", not as a job that genuinely failed. A job in flight when `maxRunDurationMs` expires is recorded the same way but names the run's clock — `error: 'Run exceeded its <n>ms time budget'` — rather than claiming an abort the caller never issued: the run budget reaches a job as an abort signal, so the `RunTimeBudget` is threaded alongside it purely so `JobBudget.check` can tell the two apart in that string.
- `jobItem.scrollIntoViewIfNeeded()` is now called with an explicit `timeout`. Nothing calls `setDefaultTimeout`, so it silently inherited Playwright's 30s default — a third of a stuck job's worst case on its own. A card that won't scroll into view in 5s is not going to click either.
- A near-spent budget skips an in-job overlay clear outright instead of running one with a 1ms deadline. `clearBlockingOverlays` escalates to its DOM-mutating neutralize tier as soon as `deadline - now <= pollIntervalMs`, so a clamped clear would have made a low-budget job skip the polite dismiss/`Escape` tiers, mutate the shared search page on its very first round, and emit `overlay:undismissed` — and a clear squeezed that small answers `stillBlocking` from one look at a page it never tried to unblock, which `dismissOverlayAfterClick` reported as a LinkedIn sign-in wall and `checkForLateOverlay` as a stale result worth a full re-scrape. Time pressure was buying *extra* whole job scrapes.
- A `companyAddresses` lookup that the calling job's budget skipped or clamped is no longer cached. The cache is run-wide, so a `null` produced by one job's clock rather than by the company page would have denied every later job at that company a real attempt and silently reported them all as address-less — the same "retries only ever upgrade the answer" invariant that keeps `[]` and `null` distinct. A failure on a healthy budget is still cached, as before. The inter-lookup politeness delay is clamped to the job's remaining time rather than always paid in full.
- `clickWithOverlayRetries` takes its trailing parameters as an options object (`{ maxAttempts, overlayClear, budget }`) rather than as positionals. Internal — it is not re-exported from `scraper/index.ts` — so only `scrapeJob` and `clickLoadPhase` had to move.

## v0.9.0

### Added

- An escalating overlay-dismissal ladder in `clearBlockingOverlays` (closes GitHub issue #27). Per round against a still-visible `.modal__overlay--visible`: one `readOverlayDiagnostics` `page.evaluate` reads the overlay's text, class list and every control's accessible name; the new exported pure helper `pickDismissButtonIndex` picks a control off those names (a dismiss-named one, else an unnamed icon-only one, else anything that is not a *Sign in* / *Join now* control, else nothing); then `Escape`; then, once `maxDismissAttempts` rounds have failed, `neutralizeOverlay` strips the `--visible` modifier and forces inline `pointer-events: none` and `visibility: hidden`. Previously the only attempt was `getByRole('button', { name: /reject|dismiss|accept/i })`, with no fallback of any kind behind it: no `Escape`, no second control, and nothing that could take an undismissable overlay out of the way — so the caller retried into the same wall until its budget ran out and job after job failed after tens of seconds. Verified live (see the Testing section of `CLAUDE.md`, and PR #30) that on a `de` guest session the overlay is LinkedIn's `modal--contextual-sign-in` sign-in wall and its close control *is* named `Dismiss`, which the old pattern would have matched — so the widened name pattern is insurance for other locales rather than the confirmed root cause, and **the neutralize tier is the rung that actually rescues the documented failure**. It is the only one measured to turn an overlay that intercepts every pointer event back into a clickable job card.
- `ScraperOptions.overlayClear.maxDismissAttempts` (default `2`) and `.neutralizeStuckOverlay` (default `true`). Both are tier *policy* and are threaded via the new `OverlayClearSettings` type to every clear site in a run — through `ScrapeContext` for the three in-job clears and `ClickLoadPhaseOptions` for the load phase — not just to the clear `runScrape` performs after `page.goto`. The `overlayClear` timing fields (`timeoutMs`, `pollIntervalMs`, `requiredConsecutiveClear`) still apply only to that first clear; every later clear keeps its own tighter budget for its own point in the job.
- `overlay:undismissed` — a new `ScrapeProgressEvent` member, emitted once per `clearBlockingOverlays` call that had to neutralize an overlay or gave up on one, carrying `neutralized: boolean` and the `OverlayDiagnostics` read off it. Deliberately silent on the ordinary path where a click or `Escape` closed the overlay, which happens on virtually every guest page load. It is the one event not tied to a job index. Consumers that only handle `job:done`/`job:stale` are unaffected — this is an additional union member, not a change to an existing one.
- New exports: `pickDismissButtonIndex` and `describeOverlayDiagnostics` (both pure), the types `OverlayDiagnostics`, `OverlayClearResult`, `OverlayUndismissedEvent`, `OverlayClearOptions` and `OverlayClearSettings`, and the selectors `OVERLAY_VISIBLE_CLASS`, `OVERLAY_BUTTON_SELECTOR`, `OVERLAY_DISMISS_NAME_PATTERN` and `OVERLAY_SIGN_IN_NAME_PATTERN`.
- A blocked job's `FailedJobResult.error` now carries the overlay diagnostics: `Blocked by LinkedIn sign-in wall (could not dismiss dialog): overlay text: "…"; classes: […]; buttons: […]`. Rendered by `describeOverlayDiagnostics` on one line, with the text, the class list and the button list all length-capped, since this string ends up verbatim in whatever log or database row the consumer keeps. This is what GitHub issue #27 lacked: the run that produced it never learned what the overlay actually said.

### Changed

- **Breaking for any direct caller of the exported `clearBlockingOverlays`:** it now returns an `OverlayClearResult` (`{ dismissed, neutralized, stillBlocking, diagnostics }`) instead of a `boolean`. The old `boolean` conflated "an overlay was dismissed" with "the page is clickable now" and left every caller re-querying the page itself to tell the two apart; `stillBlocking` is now the authoritative "the next click cannot land" answer, and `dismissOverlayAfterClick` no longer makes its own follow-up `findVisibleOverlay` call.
- `OVERLAY_SELECTOR` is now derived from the new `OVERLAY_VISIBLE_CLASS` (`'.' + OVERLAY_VISIBLE_CLASS`) rather than the class being sliced back out of the selector. Its value is unchanged. `neutralizeOverlay` hands that class to `classList.remove()`, which throws on any token containing whitespace — so a selector that later grew a second alternative the way `LIST_POSTED_AT_SELECTOR` did (GitHub issue #15) would have silently disabled the whole neutralize tier, since the caller reads the throw as "nothing to neutralize".
- `checkForLateOverlay` now reports `lateOverlayDetected` for an overlay that was merely *dismissed*, not only one that was still blocking or had to be neutralized. The flag says "an overlay was over the pane around the moment its data was read", so finding one in that window is the signal regardless of how it was eventually closed — otherwise it would have gone dead exactly as the new ladder started closing overlays the old code could not, silently costing those jobs the one retry `retryStaleJobs` gives a stale result.
- Per-click Playwright timeouts inside a clear are clamped by the remaining budget divided by the rounds still allowed plus one, instead of by the raw deadline. Both escalation triggers are only evaluated at the top of a round, so a round that overshoots the deadline used to take the neutralize tier down with it — within `checkForLateOverlay`'s 3000ms the round that would have neutralized was unreachable.
- The ladder's dismiss-click tier is split out of `clearBlockingOverlays.ts` into `clickOverlayDismissControl.ts`, taking `boundedBy` and the two caps it clamps (`MAX_DISMISS_CLICK_MS`, `MAX_HIDDEN_WAIT_MS`) with it, since those three are used by that tier and nothing else — the whole budget-clamping concern moves out as a unit instead of sitting between the reader and the rung it belongs to (271 → 217 LOC). No public API or behavior change: a null pick and a survived click both still return `false` and fall through to the `Escape` tier, no extra `findVisibleOverlay` probe runs when nothing was clicked, and `clickOverlayDismissControl` is not re-exported from `scraper/index.ts`.
- The `ScraperOptions` → `OverlayClearSettings` narrowing is split out of `runScrape.ts` and `loadAllJobs.ts` into `toOverlayClearSettings.ts`, per `src/scraper/`'s one-function-per-file convention. Both sites were spelling the two tier-policy fields out by hand, so a third option added to `ScraperOptions.overlayClear` would have had to be remembered in both places — and forgetting one would leave the load phase running a different policy than the per-job clear sites, the exact drift `OverlayClearSettings` was introduced to prevent. No public API change — `toOverlayClearSettings` is not re-exported from `scraper/index.ts`.

## v0.8.0

### Added

- `ScraperOptions.shouldScrapeJob?: (identity: JobCardIdentity) => boolean` — a pre-click filter, called with a job card's list-level identity (`title`, `sourceUrl`, `sourceHostname`, `sourceJobId`, `companyUrl`, `location`, `postedAt`) right after it's read off the card and before the card is clicked (closes GitHub issue #25). Returning `false` skips that job's full detail scrape entirely — no click, no company lookup — and records a new `status: 'skipped'` `JobResult` at that index instead; `JobResult` is now a union of `SuccessfulJobResult`, `FailedJobResult`, and the new `SkippedJobResult`. Omitted, every job is scraped as before. Must be synchronous: the return value is checked directly (`!shouldScrapeJob(identity)`), so an `async` predicate's `Promise` is always truthy and the skip branch would never fire.
- A skipped job is not registered in the run's duplicate-tracking map, so it never becomes a later duplicate's "first occurrence" — but a skipped result still reports `duplicateOfIdx` against an earlier index that already scraped the same posting, if one exists, rather than always reporting `null`.

### Changed

- The skip-branch's result-assembly logic (building the `'skipped'` `JobResult`, including the `duplicateOfIdx` self-reference guard) is split out of `scrapeJob.ts` into its own `buildSkippedResult.ts`, per `src/scraper/`'s one-function-per-file convention. No public API or behavior change — `buildSkippedResult` is not re-exported from `scraper/index.ts`.

## v0.7.1

### Changed

- `README.md` restructured for readability (GitHub issue #23): added a "Contents" table of contents, and split the dense `JobResult` "Field notes" bullet list — where each field's type shape, nullability rules, and edge cases were packed into a single 80–200+ word bullet — into a `### Field reference` subsection with one `####` heading per field. Documentation only; no behavior, code, or public API changed.

## v0.7.0

### Added

- `ScraperOptions.maxJobs?: number` and the exported pure helper `clampTotalJobs` — caps how many of the loaded jobs are actually scraped per run (GitHub issue #21). The load/discovery phase (scroll + "See more") is unaffected and always runs to completion; only the scrape loop stops early. Applied once in `runScrape`, to the count `loadAllJobs` returns, so it propagates through `ScrapeContext.totalJobs` into `scrapeAllJobsOnce`'s loop bound and every progress event's `total` without touching any other layer.

### Changed

- `scrapeJob()` no longer takes a `total: number` parameter — it was always unused (the dead code that originally surfaced the gap `maxJobs` fills). Its signature is now `scrapeJob(page, index, options)`. Breaking for any direct caller of the exported `scrapeJob`.

## v0.6.0

### Added

- `RunScrapeOptions.signal?: AbortSignal` lets a caller cancel an in-progress `runScrape()` run. Aborting stops the scrape at the next safe checkpoint — between jobs in `scrapeAllJobsOnce`/`retryStaleJobs`, or during the job-loading `scrollLoadPhase`/`clickLoadPhase`/`pollForNewJobs` polling loops — never mid-job. The run always closes the browser via `runScrape`'s existing `finally` block first, then rejects with the new exported `ScrapeAbortedError` instead of resolving. `error.name === 'AbortError'` (the same convention `fetch` uses) distinguishes a cancelled run from any other failure, and `error.partial: ScrapeOutcome` carries whatever `results`/`url` had already been collected at that checkpoint (`results` is `[]` if the signal was already aborted before the run started or during job loading). Closes GitHub issue #19.

## v0.5.0

### Added

- `sourceJobIdMismatch: boolean` on `JobResult` (`JobResultBase`), and the exported pure predicate `isSourceJobIdMismatch`. Closes a blind spot in `companyMismatch`: LinkedIn's detail pane sometimes doesn't re-render after jobs are clicked in quick succession, and when the leftover pane belongs to an *earlier posting at the same company*, the company text still matches, so `companyMismatch` never flagged it — even though `descriptionText`/`tags` could still belong to that earlier posting (GitHub issue #17). Verified live that the detail pane's own title-link href (`DETAIL_TITLE_LINK_SELECTOR`, also reused by `waitForJobDetailToLoad`) carries the ID of whichever job is actually rendered, independent of company text; `isSourceJobIdMismatch` compares that against `sourceJobId` via the existing `normalizeJobUrl`/`jobIdFromUrl` pipeline. `isStaleResult` now also ORs in this flag.

## v0.4.10

### Fixed

- `postedAt` scraping no longer fails for jobs posted within the last few hours. `LIST_POSTED_AT_SELECTOR` was hardcoded to `time.job-search-card__listdate`, but LinkedIn renders `time.job-search-card__listdate--new` on the posting-date element for very recently posted jobs instead — confirmed live where both classes coexist on the same search results page (older postings under the plain class, recent ones under `--new`). The missed variant made `readJobListIdentity` throw `"No posted date found for list item"` for every recent posting, failing those jobs outright while older postings on the same page scraped fine. `LIST_POSTED_AT_SELECTOR` now matches both classes.

## v0.4.9

### Added

- `ScraperOptions._closeBrowserAfterScrape?: { jobList?: boolean; companyPage?: boolean }` — an internal, debug-only escape hatch that lets someone debugging the built package leave the job-list browser and/or the company-lookup context open after `runScrape` finishes, instead of both being closed as usual. Only takes effect when `headless: false` is also set; ignored on headless runs, which always close normally.

## v0.4.8

### Fixed

- `scrollLoadPhase` no longer caps `totalJobs` at ~60 for every run. It previously advanced the page with a single `scrollTo(0, document.body.scrollHeight)` jump per iteration, which LinkedIn's own lazy-load listener never reacts to — only genuine incremental scroll progress triggers it — so the unique job count never grew past the ~60 jobs LinkedIn pre-renders on initial load. It now scrolls one `<li>` at a time, pausing briefly between each, after hiding the page sections LinkedIn renders above the job list so each `<li>`'s own height is the exact scroll distance to the next one. Verified live against real LinkedIn (see `CLAUDE.md`'s Testing section) that this grows the unique count well past 60 before correctly handing off to `clickLoadPhase`.
- Fixed a resume-index bug in that same fix: the per-`<li>` scroll walk tracked how far it had scrolled with an index that only ever increased. If LinkedIn re-serves a shorter page than what had already been scrolled through — a real, documented scenario (see `collectJobIds.ts`) — that index permanently pointed past the end of the (now shorter) list, and the phase would idle on its fallback pause until `stableScrollsToStop`/`maxScrollAttempts` cut it off, silently under-scraping instead of recovering. The walk now detects a live `<li>` count smaller than its resume point and restarts from the top instead of stalling.

### Changed

- `scrollLoadPhase.ts`'s three internal helpers (`hidePageSectionsAboveJobList`, `scrollToListItem`, `scrollNewlyRenderedListItems`) are split into their own files, per `src/scraper/`'s one-function-per-file convention. No public API change — none of the three were ever re-exported from `scraper/index.ts`.

## v0.4.7

### Changed

- `src/scraper.ts` (823 lines) is split into `src/scraper/`, one function per file, with `index.ts` as the folder's barrel. No public API change: `src/index.ts` re-exports exactly the same 9 values (`runScrape`, `scrapeJob`, `scrapeAllJobsOnce`, `clearBlockingOverlays`, `scrollLoadPhase`, `clickLoadPhase`, `registerJobOccurrence`, `isCompanyMismatch`, `isStaleResult`) and 4 types (`ScrapeContext`, `ScrapeJobOptions`, `ScrollLoadPhaseOptions`, `ClickLoadPhaseOptions`) it always did, unchanged.

## v0.4.6

### Changed

- `JobResult` is now a discriminated union, `SuccessfulJobResult | FailedJobResult`, instead of one flat type. This restores per-job failure isolation: `scrapeJob()` catches its own errors again and returns a `FailedJobResult` (`status: 'failed'`, `error` carrying the thrown message) instead of throwing — fixes a v0.4.5 regression where a single job's failure aborted the entire `runScrape()` run and discarded every already-scraped result. `error` is now exclusive to `FailedJobResult` (not present at all on a successful result). `JobStatus` dropped `'skipped'`, which nothing has produced since v0.4.4.
- Fixed a v0.4.5 regression that silently deleted `normalizeJobUrl`, `hostnameOf`, and `jobIdFromUrl` from `src/url.ts`'s exports. All three are restored, unchanged in behavior from before v0.4.5.

## v0.4.5

### Changed

- `JobResult.company`, `descriptionText`, `sourceJobId`, `sourceUrl`, `sourceHostname`, `companyUrl`, `location`, `postedAt`, and `tags` changed from nullable (`T | null`) to required (`T`) — `scrapeJob()` already threw instead of returning `null` for most of these; `postedAt` and `tags` are now the same. `scrapeJob()` throws `Error('No posted date found for list item')` when a job's list card has no readable `datetime` attribute, and `Error('No job criteria found for job item')` when the detail pane's job-criteria list can't be read (an empty-but-readable list still resolves to `tags: []`, not a throw).
- Fixed a bug in `scrapeJob()`'s internal `trim` helper where a failed job-criteria read (`allInnerTexts()` throwing) bypassed its own error handling and leaked the raw Playwright error instead of being caught and converted.
- `JobResult.companyAddresses` is unchanged and remains `CompanyAddress[] | null` — a company-page lookup failure still does not fail the job (see `companyLookup.ts`).

## v0.4.4

### Changed

- `scrapeJob()` now throws `Error('No job title found for this list item — LinkedIn markup has likely changed')`, when a job in the LinkedIn job search list has no `<h3>` job title or its inner text can't be read.
- `scrapeJob()` now throws if `await jobItem.scrollIntoViewIfNeeded()` throws.
- `JobResult.title` changed from type `string | null` to `string`.

## v0.4.3

### Added

- `.prettierrc` file

### Changed

- Renamed `SearchParams.keywords` to `SearchParams.keyword`, because the original `keywords` search parameter name from LinkedIn is missleading.

## v0.4.1 / v0.4.2

> Forgot what I did here. Must have been something minor.
> v0.4.1 pointed to the refactor branch commit.
> v0.4.2 pointed to the `main` branch merge commit

## v0.4.0

> `JobResult` gains three required properties: `location`, `postedAt` and `tags`.

### Added

- `JobResult.location` — the list card's location text (`span.job-search-card__location`), scraped verbatim with no parsing. Read at the same point as `sourceUrl`/`companyUrl`, so it survives a later click/detail-pane failure. `null` when the card carries no usable location span.
- `JobResult.postedAt` — the list card's posting date, read from `time.job-search-card__listdate`'s `datetime` attribute (e.g. `'2026-07-21'`) rather than the relative display text ("5 days ago"), which goes stale the moment it's stored.
- `JobResult.tags` — the _values_ (not labels) from the detail pane's job-criteria list (`ul.description__job-criteria-list`), i.e. seniority level, employment type, job function and industries, as `string[]`. `[]` and `null` are distinct, the same way they are for `companyAddresses`: `[]` means the detail pane was read and the job genuinely lists no criteria, `null` means the read never happened or failed.
- `LIST_LOCATION_SELECTOR`, `LIST_POSTED_AT_SELECTOR` and `JOB_CRITERIA_VALUE_SELECTOR` exported from `src/selectors.ts`.

### Changed

- The internal `readCompanyAndDescription` is renamed `readDetailPane` and now reads `company`/`descriptionText`/`tags` concurrently via `Promise.all` instead of two sequential awaits, since a third independent value is now read alongside them.

## v0.3.0

> `JobResult` gains two required properties, so any code constructing or
> spreading a `JobResult` literal must supply them. Every run now also visits
> LinkedIn company pages, which makes a scrape take meaningfully longer.

### Added

- `JobResult.companyAddresses` — the office addresses published on the hiring company's LinkedIn page, as `CompanyAddress[]`, **with the address LinkedIn tags "Primary" at index 0**. `[]` and `null` are distinct: `[]` means the page was read and the company publishes no address, `null` means no lookup happened or it failed. Roughly 30% of companies genuinely publish none.
- `JobResult.companyUrl` — the absolute, normalized URL of that company page, read from the card's company link (`h4.base-search-card__subtitle a`) during the same identity read as `sourceUrl`, so it survives a later click/detail-pane failure. This is also the key the run's address cache uses; the company _display name_ is deliberately not used, since LinkedIn abbreviates it in the list ("Slalom" for `slalom-consulting`) in ways that collide between unrelated companies.
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
- `sourceJobId` now falls back to the trailing posting ID in `sourceUrl` when `data-entity-urn` is unreadable. A null `sourceJobId` silently disables duplicate detection _and_ makes `waitForJobDetailToLoad` skip its detail-pane wait, which is the condition that manufactures stale results.
- The four per-job identity reads now run concurrently instead of as four sequential round-trips.
