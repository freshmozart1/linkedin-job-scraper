# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-purpose library: a Playwright driver that scrapes LinkedIn's **public/guest** job search results (no login, no credentials). It loads the observable job list via infinite scroll + "See more jobs" pagination, clicks the first list occurrence of each distinct posting, and scrapes title/company/`descriptionText` plus the posting's own source identity (`sourceJobId`/`sourceUrl`/`sourceHostname`/`scrapedAt`), with stale-result detection built in. It also follows each card's company link and scrapes that company's office addresses into `companyAddresses`.

Deliberate design constraint: **nothing about the search is hardcoded.** Every `SearchParams` field except `keywords` is optional and simply isn't sent when omitted, and every engine timing/retry constant in `ScraperOptions` is caller-overridable. Product-specific defaults (a fixed location, headless on/off) belong in the consumer, not here. Resist requests to bake a default search into the engine.

This scrapes an unofficial, moving surface — LinkedIn's markup and anti-bot gating change and vary by session.

## Commands

```bash
npm run build       # clean dist/, then tsc -> JS + .d.ts + sourcemaps
npm run clean       # remove only the generated dist/ directory
npm test            # node --import tsx --test "test/*.test.ts" (offline, no browser)
npm run typecheck   # tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json

# single test file / single test by name:
node --import tsx --test test/scraper.test.ts
node --import tsx --test --test-name-pattern "registerJobOccurrence" test/scraper.test.ts
```

There is no lint script; `typecheck` is the correctness gate. The `test` glob is non-recursive on purpose, so `test/helpers/**` is never collected as a test file.

`prepare` runs `build` on install. That is load-bearing, not cosmetic: `dist/` is gitignored, and the consuming app installs this repo as a **git dependency**, so npm must compile on install or the consumer resolves `main`/`types` to nothing. Don't remove it, and don't commit `dist/`.

`build` explicitly runs `clean` before compiling. TypeScript does not remove output for deleted source files: after `src/scraper.ts` moved to `src/scraper/index.ts`, a leftover `dist/scraper.js` took precedence over the new directory in Node's module resolution (GitHub issue #44). Keep the portable Node.js cleanup in the normal build path, including `prepare`, and keep hand-written files outside `dist/`. `test/build.test.ts` copies the package sources into temporary fixtures, seeds obsolete output, runs the real build/prepare scripts, and checks the package main's current exports. It also verifies fresh preparation without an existing `dist/`; it never rebuilds or deletes another checkout's output.

## Architecture

`src/index.ts` is the only public surface — it re-exports the types, the selectors, `buildSearchUrl`, and the scraper functions. Internal helpers in `scraper/` are intentionally not exported; the exported subset is what the tests drive directly.

- **`src/url.ts`** — All pure URL logic, in two halves. Outbound: `buildSearchUrl(SearchParams)`, holding LinkedIn's guest-search query code tables (`f_TPR` date, `f_E` experience, `f_JT` job type, `f_WT` workplace, `sortBy`) that map friendly union members onto LinkedIn's opaque codes; `extraParams` is the escape hatch for params not explicitly modeled. Inbound: `normalizeJobUrl`/`normalizeCompanyUrl`/`hostnameOf`/`jobIdFromUrl`, which turn a scraped `href` into the `sourceUrl`/`sourceHostname`/`sourceJobId`/`companyUrl` fields. All are exported so consumers can re-derive the derived fields from a stored URL rather than trusting a persisted value. `normalizeJobUrl` and `normalizeCompanyUrl` are two names over one shared `normalizeLinkedInUrl` — the reasoning below applies identically to both, and the company link carries its own `?trk=` tracking param.

  Three non-obvious things `normalizeJobUrl` has to do, each of which was a real bug: `getAttribute` returns the **raw** attribute, so a relative href stays relative unless resolved against the search URL; the card href carries a per-session `refId`/`trackingId`/`position` query string, so an unstripped URL differs on every run and breaks consumer dedupe/upsert; and `new URL('javascript:void(0)')` **parses without throwing** and reports an empty-string hostname, so a bare try/catch isn't enough to reject non-URLs.
- **`src/selectors.ts`** — Every CSS selector in one place, exported so consumers and tests don't hand-duplicate the strings. `LIST_POSTED_AT_SELECTOR` matches two classes, not one: LinkedIn renders `time.job-search-card__listdate--new` (not the plain `job-search-card__listdate`) on the posting-date element for very recently posted jobs, confirmed live where both classes coexist on the same mixed-age search results page. Missing the `--new` variant made `readJobListIdentity` throw `"No posted date found for list item"` for every recent posting, failing those jobs outright (GitHub issue #15) while older postings on the same page scraped fine — the kind of silent, age-dependent selector gap that's easy to miss because most manual testing samples older, already-settled listings.
- **`src/types.ts`** — All public types. No runtime code.
- **`src/address.ts`** — Pure parsing of a company page's Locations markup into `CompanyAddress[]`. No Playwright import, so all of it is testable offline; `companyLookup.ts` reads the raw text and hands it here.
- **`src/companyLookup.ts`** — The browser half of the address lookup: its own context, one page, one cache. See the cookie section below, which is the only reason this file exists separately.
- **`src/scraper/`** — The whole engine, one function per file (e.g. `scrapeJob.ts`, `runScrape.ts`, `clearBlockingOverlays.ts`), with `index.ts` as the folder's own barrel re-exporting exactly the same names `src/index.ts` re-exports from it. Splitting a function out of one of these files still means adding `export` to it and importing it by name from a sibling file — privacy is enforced entirely by what `scraper/index.ts` chooses to re-export, not by what's `export`ed at the file level. The parts that carry non-obvious reasoning:

### Validate initial navigation before discovering jobs

`runScrape` keeps the response returned by the initial `page.goto` and calls `validateSearchNavigation` before overlay clearing or list discovery (GitHub issue #41). Playwright resolves navigation even for HTTP errors, so an error document without cards otherwise looks like a successful empty search. Missing responses and non-success statuses reject actionably. `validateSearchDestination` separately checks that the reached URL remains on a LinkedIn host and the requested search path, allowing country subdomains, changed query strings and a trailing slash. It does not require any cards or introduce new DOM selectors: a valid zero-result search must still succeed. Unexpected destinations are reported without query parameters.

The caller-abort and run-budget checks immediately after navigation precede these validations, so an error page arriving after a cancellation or deadline does not replace the requested stop outcome. All checks remain inside the existing cleanup boundary. `test/runScrape.test.ts` uses the existing fake-browser helpers and Node's built-in method stub to cover HTTP failures, redirected destinations, empty success, cleanup and stop precedence without a browser or network requests.

### Load phases track raw and unique progress; results traverse unique postings

`scrollLoadPhase` (LinkedIn's automatic infinite scroll) then `clickLoadPhase` (manual "See more jobs" clicks once the button appears). Both read `collectJobListState()`, which reports the raw h3-bearing card count and an ordered first-occurrence mapping of unique posting IDs. Identity prefers `data-entity-urn`, falls back to the normalized card href, and retains every unparseable card separately so a markup failure is reported rather than hidden. Scrolling stops the moment the "See more" button appears rather than waiting for growth to stall, since the button can appear first.

`scrollLoadPhase` scrolls exactly one `<li>` at a time, never a single jump to the bottom — LinkedIn's own lazy-load listener only reacts to genuine incremental scroll progress, and a `scrollTo(0, document.body.scrollHeight)` jump never triggers it, which used to cap every run at the ~60 jobs LinkedIn pre-renders on initial load regardless of how many results actually existed (GitHub issue #10). Before scrolling starts, it hides the page sections LinkedIn renders above the job list so each `<li>`'s own rendered height is the exact pixel distance to the next one — see the Testing section below for how this was verified live and a live-only bug it caught.

Unique-count stability alone is not proof that loading is exhausted: LinkedIn can append overlapping `start=25`/`start=50` batches containing only IDs already present in the initial render, before a later batch introduces new jobs (GitHub issue #39). `stableScrollsToStop` and `stableClicksToStop` therefore advance only when both the unique and raw counts are unchanged. Raw-only progress resets stability but never changes reported totals or emits `jobs:loading`; `maxScrollAttempts` and `maxSeeMoreClicks` bound a session that appends duplicate rows forever.

`loadAllJobs` returns the final ordered mapping, not just its count. `runScrape` applies `maxJobs` to that unique mapping, assigns contiguous logical result indices, and re-resolves every parseable posting by exact `sourceJobId` before both the first pass and retry. The recorded raw index is only authoritative for an unparseable card; for a parseable card that disappeared, it is a deliberate failure target protected by an expected-ID check, never permission to scrape whichever card shifted into that slot. The exported `scrapeJob(page, index, options)` and `scrapeAllJobsOnce` stay on their historical raw-index path for direct callers.

### Overlays can appear at any moment, including mid-click

LinkedIn's guest pages block clicks behind `.modal__overlay--visible` (cookie consent on load, a "sign in to view more jobs" nag later). `clearBlockingOverlays` polls rather than checking once, and only concludes "clear" after several consecutive not-visible reads. `clickWithOverlayRetries` uses short click attempts with an overlay clear between each, because a single long `click()` can get stuck retrying against an overlay that appeared while Playwright was inside its own retry loop.

The overlay selector stays narrow (`.modal__overlay--visible`) on purpose — a broader `[role="dialog"]`/`[role="alert"]` also matches always-visible accessibility live-regions earlier in the DOM, which made `.first()` pick the wrong element.

A clear escalates cheapest-first rather than repeating one blind click (GitHub issue #27, where a `.modal__overlay--visible` intercepted every click at the job list and nothing in this function could get rid of it — one name-matched click attempt, and no fallback at all behind it). Per round against a still-visible overlay: `readOverlayDiagnostics` reads text, classes and every control's accessible name in one `page.evaluate`; `pickDismissButtonIndex` picks a control off those names — a dismiss-named one, else an unnamed (icon-only) one, else anything that isn't *Sign in*/*Join now*, else nothing, because navigating off the search page is worse than the overlay; then `Escape`; and once `maxDismissAttempts` rounds have failed, `neutralizeOverlay` strips the `--visible` modifier and forces `pointer-events: none` **and** `visibility: hidden`. Both inline styles are needed — `findVisibleOverlay` asks Playwright `isVisible()`, which reports a `pointer-events: none` element as perfectly visible, so forcing only pointer-events would leave every caller reading `stillBlocking: true` against a page that is actually clickable.

Every per-click timeout is clamped by `boundedBy(deadline, cap, roundsLeft)`, which divides the *remaining* budget by the rounds still allowed plus one. Both escalation triggers are only evaluated at the top of a round, so without that reserve a round can overshoot the deadline and take the neutralize tier down with it — at `checkForLateOverlay`'s 3000ms two full-cost rounds end past the deadline with `failedRounds` only just reaching `maxDismissAttempts`, and the round that would have neutralized never runs.

`clearBlockingOverlays` returns an `OverlayClearResult`, not a boolean: `stillBlocking` (not `!dismissed`) is the "the next click cannot land" answer, so callers no longer re-query the page themselves. `ScraperOptions.overlayClear`'s two tier-policy fields (`maxDismissAttempts`, `neutralizeStuckOverlay`) are threaded to *every* clear site via `OverlayClearSettings` — through `ScrapeContext` for the in-job clears and `ClickLoadPhaseOptions` for the load phase — since applying them only to `runScrape`'s own clear would mutate the DOM on every job for a caller who asked for `neutralizeStuckOverlay: false`. The timings stay per-site: each clear has its own budget for its own point in the job.

The ladder is spread over five files, and the split lines are not arbitrary. `clearBlockingOverlays.ts` keeps only the poll-and-escalate state machine, whose branches share six pieces of loop-carried state and read top-to-bottom. `clickOverlayDismissControl.ts` owns the dismiss-click tier *and* `boundedBy` with the two caps it clamps (`MAX_DISMISS_CLICK_MS`, `MAX_HIDDEN_WAIT_MS`) — nothing else uses them, so the whole budget-clamping concern moves out whole rather than making every reader of the ladder wade through it. It takes `diagnostics` as a non-nullable parameter on purpose: `pickDismissButtonIndex` returns a *positional* index, so a retained read from an earlier round can describe a modal that is no longer the first match and send the click into the new one's *Sign in* — a caller with nothing fresh to pass has nothing to click and must not call it. `toOverlayClearSettings.ts` is the `ScraperOptions` → `OverlayClearSettings` narrowing; it is a function rather than a spread because `runScrape` and `loadAllJobs` both need it and were each spelling the two fields out by hand, so a third tier option would have had to be remembered in both — and a spread of the caller's whole `overlayClear` would carry the timing fields too, overwriting each site's own budget with one chosen for a different site. `describeOverlayDiagnostics.ts` renders the diagnostics to one length-capped line; it is public because that exact string is what a blocked job's `error` carries, and a consumer handling `overlay:undismissed` should not have to re-derive the format. `readOverlayDiagnostics.ts` and `neutralizeOverlay.ts` stay internal — they are `page.evaluate` bodies, untestable without a browser and useless outside the ladder.

### Identity gating, staleness, and the single retry pass

LinkedIn's detail pane sometimes doesn't re-render when cards are clicked quickly. `waitForJobDetailToLoad` therefore treats its target-link visibility wait only as a trigger: it reads the actual first title-link href, runs it through `normalizeJobUrl` + `jobIdFromUrl`, and accepts only an exact match with the card's `sourceJobId`. Once matched, the existing best-effort `networkidle` wait lets the remaining fields settle and the ID is checked again immediately afterward. A failed initial check gets exactly one immediate high-level re-click through the existing overlay-aware click and post-click clear; a second failure throws `DetailPaneIdentityError`, producing `failureReason: 'detail-pane-identity-unverified'` with every detail-derived field left null. Missing card source IDs already fail in `readJobListIdentity` before any click, so the gate never has to guess.

Three post-gate flags remain as defenses against later changes or unrelated hazards: `companyMismatch`, `sourceJobIdMismatch`, and `lateOverlayDetected`. `sourceJobIdMismatch` still closes the same-company blind spot if the pane changes between the gate and the final detail read. `checkForLateOverlay` returns `stillBlocking || neutralized || dismissed`; finding an overlay in that window is the signal regardless of how it was removed. `isStaleResult()` folds the flags together and only accepts successful results.

Successful stale jobs and explicit identity-gate failures get **exactly one** retry, deferred until the whole list has been scraped once (`retryStaleJobs`) — by then the page has settled, and the extra pre-click delay doesn't compound into every job. Each scrape attempt may perform at most one immediate recovery re-click. `scrapeJobAndRecord` writes `results[index] = result` so a retry replaces rather than appends.

### The stale diagnostics record recovery without controlling it

GitHub issue #29's diagnostics established that title-link timeouts, not overlays, drive the stale reads; issue #35 adds the recovery policy while keeping diagnostics observational. Turning diagnostics off never changes the identity gate or retry behavior.

`createStaleDiagnostics` is a mutable per-job recorder created in `scrapeJob` right where `createJobBudget` is and threaded exactly the way `budget` is: an **optional trailing parameter** on `clickWithOverlayRetries` / `dismissOverlayAfterClick` / `waitForJobDetailToLoad` / `readJobDetailPane`. Omitting it skips collection while leaving the identity gate and recovery decisions unchanged. It is assigned into rather than returned on success, mirroring `readJobListIdentity`'s `identity`: a job that throws partway still hands back what it saw. Skipped jobs finalize a minimal `resultStatus: 'skipped'` record so every list index remains present for positional analysis; status-aware denominators keep those rows from diluting stale rates.

Three measurements carry the weight. `detailIdentityChecks` records the initial and optional recovery comparison, including each `WaitObservation`, observed href and parsed ID; the legacy `titleLinkWait` remains the initial wait for compatibility. `overlayChecks` retains every pre-click attempt, post-click clear and late clear, while `clickAttempts` accumulates low-level attempts across both activations. Snapshot capture keeps its existing explicit outcome and error.

`summarizeStaleDiagnostics` and `describeStaleReport` are pure and exported. Records carry a generated `runId` and `totalJobs`, so concatenated runs never infer boundaries or halves from array order. Exact `index - 1` lookup within the same run/pass drives predecessor conditions, and clusters are grouped by run identity.

Two things about the report's shape are load-bearing. `byCombination` carries all eight keys including zeros. Headline rates, combinations, positions and condition correlations use successful **first-pass** jobs only: retries remain raw evidence and recovery counters, while failed/skipped results can never count stale. Each condition reports the stale rate with it against the rate without it.

`scripts/diagnose-stale.ts` drives it live (`npx tsx scripts/diagnose-stale.ts`), defaulting to the issue's exact repro. It is in `tsconfig.test.json`'s `include` so `npm run typecheck` covers it, and deliberately **not** in `tsconfig.json`, so it never lands in the published `dist/`.

### Identity reads are bounded, concurrent, and individually recoverable

`readJobIdentity` reads five things off the list item (title, list company, `data-entity-urn`, job href, company href) in one `Promise.all`. Three properties there are load-bearing:

- **Every read carries an explicit `{ timeout: 1000 }`.** Playwright's default is 30s and its `getAttribute`/`innerText` auto-wait for the element, so an unbounded read turns one renamed class into ~30s of dead wait *per job* — an hour on a 120-job run, with nothing surfaced.
- **Every read has its own `.catch(() => null)`.** An unguarded rejection takes down the whole identity, including the `sourceUrl` that is specifically supposed to survive a later failure.
- **They're concurrent** because they have no data dependency on each other; sequentially, the degenerate all-missing case costs 5× the timeout.

`sourceJobId` prefers `data-entity-urn` but falls back to the trailing ID in `sourceUrl`. Two independent carriers mean one attribute rename does not take duplicate detection and detail-pane verification down together. If neither carrier yields a complete posting ID, `readJobListIdentity` fails the card before any click instead of letting the detail gate guess.

### `runScrape` drops duplicate occurrences; low-level callers can still mark them

Ordinary `runScrape` traversal sees one card per parsed posting ID, so its results normally carry `duplicateOfIdx: null`. `registerJobOccurrence` remains load-bearing for direct raw-index callers: it maps a posting ID to the index of its **first** occurrence and must never repoint that map. A retry at the same logical index must not see itself as a duplicate.

### Progress events

`onProgress` receives a `ScrapeProgressEvent` union: `jobs:loading` (unique count grew during loading), `jobs:found` (loading done, total about to be scraped), `job:start`, and then **either** `job:done` **or** `job:stale` per job — never both. A retry re-emits for the same index. `overlay:undismissed` is the one member not tied to a job index — it fires from any clear site that had to neutralize an overlay or gave up on one, carries the `OverlayDiagnostics` read off it, and is deliberately silent on the ordinary path where a click or `Escape` closed the overlay (which happens on virtually every guest page load).

### `maxJobs` caps the scrape, not the load

`clampTotalJobs` is applied exactly once, in `runScrape`, to `loadAllJobs`'s unique count — `loadAllJobs` itself always runs to completion regardless of `maxJobs` (GitHub issue #21 scoped it that way deliberately). `runScrape` then slices the first N entries from the ordered unique mapping, so duplicate raw positions consume no slots. The single `ScrapeContext.totalJobs` field feeds every progress event's `total`; the internal unique traversal uses the selected mapping's length, while exported `scrapeAllJobsOnce` retains its raw `totalJobs` loop bound.

### `shouldScrapeJob` skips before the click, not the read

`scrapeJob` always runs `readJobListIdentity` first — `shouldScrapeJob` is consulted with the fully-populated `JobCardIdentity`, not a cheaper partial read, because the identity read is needed either way on the non-skip path and is required to name a job precisely in the `'skipped'` result. A `false` answer returns a `status: 'skipped'` result before `registerJobOccurrence`, the pre-click delay, the click, and the company lookup ever run.

Skipping the job means it's also skipped for duplicate-tracking *registration*: a skipped job never becomes `seenSourceJobIds`'s "first occurrence" for a later duplicate to point at (mirrors `registerJobOccurrence`'s own "don't repoint the map" rule above). But a skipped result still reports `duplicateOfIdx` against an *earlier* index that already registered the same `sourceJobId` — hardcoding it to `null` regardless would violate the field's own contract for the "scraped, then a later duplicate gets skipped" ordering. That lookup guards against pointing an index at itself the same way `registerJobOccurrence` does, since `shouldScrapeJob` is consulted again on `retryStaleJobs`'s single retry pass for a job that came back `'success'` yet stale — so a stateful predicate can see the same job card twice, with different answers, across the two passes.

### Cancellation via AbortSignal

`RunScrapeOptions.signal` is checked at the loop checkpoints — the top of the first-pass/retry job loops and `scrollLoadPhase`/`clickLoadPhase`/`pollForJobListProgress` (before each scroll/click/poll attempt) — *and*, since GitHub issue #28, at the step boundaries inside a job, via `JobBudget` (see the Time budgets section below). Mid-job used to be off limits because a job's click/read sequence had no safe place to stop partway; the per-job budget created those places, and it carries the signal for the same reason it carries a deadline — checked only between jobs, an abort could not take effect until the in-flight job finished, up to the ~100s a stuck one can take. That job is then recorded as an ordinary `status: 'failed'` with `error: 'Scrape aborted'` and whatever identity it had read, so it keeps an honest slot in `ScrapeAbortedError.partial.results`.

Every loop checkpoint still only *breaks its loop early*; none of them know about `ScrapeAbortedError`. `runScrape` is the sole place that translates an abort into a rejection (checking `signal?.aborted` once before `chromium.launch`, and again after the initial navigation, `loadAllJobs`, `scrapeLoadedJobsOnce`, and `retryStaleJobs` each return) — keeping that translation in one place instead of duplicating it across every sub-function, and keeping each sub-function's own contract (and tests) about "stopping early," not about the public error type. `createJobBudget` is the one other reader of `signal?.aborted`, and it throws a plain `Error`, never `ScrapeAbortedError`, for exactly that reason. Every one of those throws sits inside `runScrape`'s existing `try`, so its `finally` still always closes the browser; the one exception is the pre-launch check, which throws before `chromium.launch` runs and therefore has nothing to close yet — the same reason `chromium.launch` itself sits outside that `try` in the first place.

### Time budgets clamp waits; they do not race them

Two budgets bound a scrape (GitHub issue #28). Neither is a race between the work and a timer, and that is the whole design: Playwright honours the timeouts it is handed, so clamping each individual wait bounds *real* elapsed time **and** leaves no orphaned browser work running behind a promise that already resolved.

`createJobBudget` (`ScraperOptions.perJobTimeoutMs`, default 45s) is one deadline plus the run signal, created per job in `scrapeJob` and threaded into every wait below it. Three methods, and the split between them is load-bearing:

- **`boundedTimeout(cap)` never throws.** `trim` swallows every rejection from its reads and returns the missing-element fallback, so a clamp that threw would be laundered into `No job title found for this list item` — this repo's signal for a real selector regression (issue #15). It also never returns `0`, since Playwright reads `0` as "no timeout", the exact opposite of a spent budget; a spent budget yields `1`.
- **`check()` is what actually stops a job**, at a step boundary where the thrown message survives into the `status: 'failed'` result. Because `boundedTimeout` collapses a read rather than failing it, `check()` has to be called before *every* throw that a collapsed read could reach — the per-field guards in `readJobListIdentity`/`readJobDetailPane`, the tags guard in `scrapeJob`, and the retry ladder in `clickWithOverlayRetries` (which would otherwise report `locator.click: Timeout 1ms exceeded` instead of the documented budget message). Skipping one of those calls doesn't lose the failure; it misattributes it, which is worse.
- **`boundedClearTimeout(budget, cap, pollIntervalMs)` returns `null` instead of a tiny timeout.** An overlay clear is not an ordinary wait: `clearBlockingOverlays` escalates to its DOM-mutating neutralize tier as soon as `deadline - now <= pollIntervalMs`, so a `timeoutMs` clamped below one poll interval makes a low-budget job skip the polite tiers, mutate the shared page on round one, and report `overlay:undismissed`. A clear squeezed that small also answers `stillBlocking` from one look at a page it never tried to unblock, which `dismissOverlayAfterClick` would report as a sign-in wall and `checkForLateOverlay` as a stale result worth a full re-scrape. Below the floor, the three in-job clear sites skip the clear entirely.

`createRunTimeBudget` (`ScraperOptions.maxRunDurationMs`, no default) is the run's budget expressed as an `AbortSignal` rather than a new parameter on every phase, so every checkpoint that already stops on `signal?.aborted` honours it for free. It is also the only place that can tell the two apart, since it is the only holder of both signals before they are composed: `exceededReason()` returns a message only when the timer fired *and* the caller's own signal did not, so a plain caller abort still rejects with `ScrapeAbortedError` while an expired budget *resolves* with `ScrapeOutcome.stoppedEarly: 'run-time-budget'`. That one nullable string serves both readers — `runScrape`'s three checkpoints, and `JobBudget.check`, which is handed the `RunTimeBudget` alongside the composed signal so a job caught in flight reports `Run exceeded its <n>ms time budget` instead of claiming an abort the caller never issued. It guards its input rather than passing it straight through — `AbortSignal.timeout` validates its delay as a uint32 and throws `ERR_OUT_OF_RANGE` for a fraction, `Infinity`, `NaN`, or anything past 2³¹-1, synchronously, before `chromium.launch`.

The company lookup takes the budget too (it is the single most expensive step in a job), with one rule attached: **a `null` the budget produced is never cached.** The cache is run-wide, so caching a lookup that was skipped or clamped by one job's clock would deny every later job at that company a real attempt and silently report them all as address-less — the same "retries only ever upgrade the answer" invariant that keeps `[]` and `null` distinct.

### Debug-only browser retention

`runScrape`'s `finally` block always closes `companyLookup`'s context and the shared `browser` — except when `scraperOptions.headless === false` and `scraperOptions._closeBrowserAfterScrape.jobList`/`companyPage` is explicitly set to `false`. This is deliberately internal (leading underscore, JSDoc-flagged "not for regular consumers"): it exists so someone debugging the *built* package can inspect a headed run's browser state after `runScrape` returns instead of losing it the instant the call resolves. It's ignored entirely on a headless run — there's no window to inspect there, so that case always closes normally regardless of the option.

## Company addresses: the cookie jar is load-bearing

The single most important fact in this repo. **LinkedIn only serves a company page's `section.locations` to a cookie jar that has not already seen a company page.** Load two company pages in a row on the same `BrowserContext` and the second one comes back *without* the section — no error, no `/authwall` redirect, the markup is simply absent. That degraded page is byte-for-byte indistinguishable from a company that genuinely publishes no address, so getting this wrong doesn't fail loudly; it quietly reports every company as address-less.

Measured over the 54 distinct companies behind one 60-job search:

| Approach | Companies returning their Locations section |
|---|---|
| One reused context | 1 / 54 |
| Fresh `browser.newContext()` per page | 54 / 54 |
| **`context.clearCookies()` before each `goto`** | **54 / 54** |

`clearCookies()` is as effective as a fresh context and far cheaper, so that's what `companyLookup.ts` does — before *every* navigation, not just the first. If a run ever comes back with all-empty `companyAddresses`, suspect this before concluding LinkedIn removed the data.

This is also why the lookup runs on a **dedicated context**: clearing cookies on the search context would throw away the guest job session mid-run. The two surfaces gate independently — the job search keeps working normally even while company pages are fully authwalled.

Two more constraints from the same investigation:

- **`fetch()` is answered with HTTP 999.** There is no request-only shortcut; the page has to be genuinely navigated to.
- **Coverage is ~70%, and the section is intermittent.** The same company can answer with addresses on one load and nothing on the next, so an empty result gets `emptyRetries` (default 1) more attempts — that same budget also covers an `/authwall` bounce and a navigation that throws, so setting it to 0 disables all three. The remaining ~30% genuinely publish nothing. Don't read a partial result as a broken selector.

Retries only ever *upgrade* the answer: a failed attempt never overwrites an earlier successful read, because `[]` (page read, company publishes nothing) and `null` (nothing could be read) are distinct answers on `JobResult.companyAddresses` and the loser gets cached for the rest of the run.

Parsing notes worth keeping: the **last `<p>` in a location `<li>` is always the locality line** and everything before it is street — reading the *first* line as the street breaks every address that has no street block. The primary address is marked by the presence of a `.tag-sm` span, matched on presence rather than its "Primary" text, which is subject to localization. Collapsed locations past the first four are hidden with CSS only and are already in the DOM, so nothing needs clicking — but `innerText` returns empty for them, which is why the evaluate reads `textContent`.

## The missing DOM lib is intentional

`tsconfig.json` sets `"lib": ["es2023"]` with **no** `dom`, so this compiles cleanly as a Node library without leaking browser globals into consumers' type space. The cost: code inside `page.evaluate()` (which runs in the browser) has no DOM types, so `collectJobListState`, `hidePageSectionsAboveJobList`, and `scrollToListItem` name the handful of members they use through a structural `globalThis as unknown as {...}` cast. Don't "fix" those casts by adding `"dom"` to `lib`.

Related trap: `page.evaluate` serializes its callback with `toString()`, so it **cannot close over module imports**. `JOB_LIST_SELECTOR` is therefore hardcoded literally inside `collectJobListState` and `scrollToListItem`, and `COMPANY_LOCATION_ITEM_SELECTOR`/`COMPANY_PRIMARY_TAG_SELECTOR` inside `readRawLocations`, in addition to living in `selectors.ts`. All copies are commented; keep them in sync.

`tsconfig.test.json` overrides `rootDir` to `"."` because the base config's `rootDir: "src"` (needed for a flat `dist/`) doesn't cover `test/**`. Harmless there since that program is `noEmit`.

## Testing

`node:test` + `node:assert/strict` — no Jest/Mocha/Vitest, and **no mocking library**. `test/helpers/fakePlaywright.ts` provides `createFakePage`/`createFakeLocator`: plain objects implementing only the `Page`/`Locator` methods the scraper actually calls, cast to the real type via `as unknown as`. Follow that pattern rather than introducing a mocking framework — and extend the fake's config surface when new methods are needed instead of loosening the cast.

No test launches a real browser, so the suite is fast and offline. That also means selector correctness against live LinkedIn markup is **not** covered by tests — changes to `selectors.ts` (or to any other code that reasons about real DOM structure or timing, e.g. the scroll phases) need manual verification against the real page.

### Manual verification against live LinkedIn (Chrome DevTools MCP)

For any change whose correctness depends on real LinkedIn markup or browser
behavior — not just this repo's own control flow — verify it live using the
Chrome DevTools MCP tools, the same way GitHub issue #10 (scroll phase
capped at 60 jobs) was diagnosed and fixed:

1. `new_page` with a fresh `isolatedContext` name against a real guest
   search URL (e.g.
   `https://www.linkedin.com/jobs/search?keywords=Frontend-Entwicklung&location=Deutschland&geoId=101282230`,
   consistently 800+ matches). A fresh isolated context avoids the
   persistent MCP Chrome profile's leftover cookies redirecting to
   `/authwall` — that redirect is a cookie-jar *inconsistency*, not simply
   "no cookies" (see the company-addresses section above), and a clean
   isolated context sidesteps it.
2. Dismiss the cookie-consent banner and the "sign in to view more jobs"
   overlay via `evaluate_script` (click the accept button / remove
   `.modal__overlay--visible`) to reach the same DOM state the real scraper
   operates in.
3. `evaluate_script` a snippet that is byte-for-byte the function body under
   test (not a paraphrase of it) against the live page, and compare against
   a **negative control**: the previous/old behavior run the same way on a
   fresh page. For issue #10, this caught something the code itself
   couldn't reveal any other way: `scrollBy`-driven incremental scrolling
   grew the unique job count from 56 to 96 before the "See more jobs"
   button correctly appeared, while the old single `scrollTo` jump grew the
   raw `<li>` count but left the *unique* count flat — LinkedIn was
   re-serving earlier jobs verbatim, not loading new ones.
4. `take_screenshot` before/after for visual confirmation alongside the
   `evaluate_script` data.

This method also caught a live-only bug this issue's fix would otherwise
have shipped with: `header.base-serp-page__header.global-alert-offset.sticky-header`
only gains its `.show` class (and becomes `position: sticky`, pinned at the
viewport top, ~80px tall) *after* the user has already scrolled past its
original position — a selector match on `.show` therefore always misses on
a one-time, pre-scroll hide pass, and the header then permanently eats
space out of every later scroll step once LinkedIn's own JS adds `.show`
mid-run. No offline test can catch a DOM state that only exists after a
real browser has already scrolled a real page. The fix is to hide the
element unconditionally (drop `.show` from the selector) — a `display:
none` set before the class is ever added still holds once it is.

The same method verified the overlay ladder (GitHub issue #27), and the
useful part there was the **hit test**, not the screenshot: with a
`.modal__overlay--visible` armed, `document.elementFromPoint()` at a job
card's centre returns the overlay itself (`interceptedByOverlay: true`,
`jobCardReachable: false`) — the DOM-side reading of the same
`subtree intercepts pointer events` Playwright reports — and after
`neutralizeOverlay`'s exact body runs, that hit test returns the card's own
`base-card__full-link`. Running each tier against the live page is also
what established two facts no offline test could: the overlay is LinkedIn's
`modal--contextual-sign-in` sign-in wall (five of them sit in the DOM at
once, exactly one carrying `--visible`), and its close control is named
`Dismiss` on a `de` guest session — i.e. the widened name pattern is
insurance for other locales, and it is the neutralize tier that carries the
fix. Note the armed overlay computes to `opacity: 0` with
`pointer-events: auto`: invisible to the eye while intercepting every
click, and reported by Playwright's `isVisible()` as perfectly visible,
which is why neutralizing forces `visibility: hidden` rather than trusting
`pointer-events` alone.
