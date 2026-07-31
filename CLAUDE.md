# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-purpose library: a Playwright driver that scrapes LinkedIn's **public/guest** job search results (no login, no credentials). It loads every job on a search via infinite scroll + "See more jobs" pagination, clicks each job card, and scrapes title/company/`descriptionText` plus the posting's own source identity (`sourceJobId`/`sourceUrl`/`sourceHostname`/`scrapedAt`), with duplicate and stale-result detection built in. It also follows each card's company link and scrapes that company's office addresses into `companyAddresses`.

Deliberate design constraint: **nothing about the search is hardcoded.** Every `SearchParams` field except `keywords` is optional and simply isn't sent when omitted, and every engine timing/retry constant in `ScraperOptions` is caller-overridable. Product-specific defaults (a fixed location, headless on/off) belong in the consumer, not here. Resist requests to bake a default search into the engine.

This scrapes an unofficial, moving surface — LinkedIn's markup and anti-bot gating change and vary by session.

## Commands

```bash
npm run build       # tsc -p tsconfig.json -> dist/ (JS + .d.ts + sourcemaps)
npm test            # node --import tsx --test "test/*.test.ts"  (101 tests, no browser)
npm run typecheck   # tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json

# single test file / single test by name:
node --import tsx --test test/scraper.test.ts
node --import tsx --test --test-name-pattern "registerJobOccurrence" test/scraper.test.ts
```

There is no lint script; `typecheck` is the correctness gate. The `test` glob is non-recursive on purpose, so `test/helpers/**` is never collected as a test file.

`prepare` runs `build` on install. That is load-bearing, not cosmetic: `dist/` is gitignored, and the consuming app installs this repo as a **git dependency**, so npm must compile on install or the consumer resolves `main`/`types` to nothing. Don't remove it, and don't commit `dist/`.

## Architecture

`src/index.ts` is the only public surface — it re-exports the types, the selectors, `buildSearchUrl`, and the scraper functions. Internal helpers in `scraper/` are intentionally not exported; the exported subset is what the tests drive directly.

- **`src/url.ts`** — All pure URL logic, in two halves. Outbound: `buildSearchUrl(SearchParams)`, holding LinkedIn's guest-search query code tables (`f_TPR` date, `f_E` experience, `f_JT` job type, `f_WT` workplace, `sortBy`) that map friendly union members onto LinkedIn's opaque codes; `extraParams` is the escape hatch for params not explicitly modeled. Inbound: `normalizeJobUrl`/`normalizeCompanyUrl`/`hostnameOf`/`jobIdFromUrl`, which turn a scraped `href` into the `sourceUrl`/`sourceHostname`/`sourceJobId`/`companyUrl` fields. All are exported so consumers can re-derive the derived fields from a stored URL rather than trusting a persisted value. `normalizeJobUrl` and `normalizeCompanyUrl` are two names over one shared `normalizeLinkedInUrl` — the reasoning below applies identically to both, and the company link carries its own `?trk=` tracking param.

  Three non-obvious things `normalizeJobUrl` has to do, each of which was a real bug: `getAttribute` returns the **raw** attribute, so a relative href stays relative unless resolved against the search URL; the card href carries a per-session `refId`/`trackingId`/`position` query string, so an unstripped URL differs on every run and breaks consumer dedupe/upsert; and `new URL('javascript:void(0)')` **parses without throwing** and reports an empty-string hostname, so a bare try/catch isn't enough to reject non-URLs.
- **`src/selectors.ts`** — Every CSS selector in one place, exported so consumers and tests don't hand-duplicate the strings. `LIST_POSTED_AT_SELECTOR` matches two classes, not one: LinkedIn renders `time.job-search-card__listdate--new` (not the plain `job-search-card__listdate`) on the posting-date element for very recently posted jobs, confirmed live where both classes coexist on the same mixed-age search results page. Missing the `--new` variant made `readJobListIdentity` throw `"No posted date found for list item"` for every recent posting, failing those jobs outright (GitHub issue #15) while older postings on the same page scraped fine — the kind of silent, age-dependent selector gap that's easy to miss because most manual testing samples older, already-settled listings.
- **`src/types.ts`** — All public types. No runtime code.
- **`src/address.ts`** — Pure parsing of a company page's Locations markup into `CompanyAddress[]`. No Playwright import, so all of it is testable offline; `companyLookup.ts` reads the raw text and hands it here.
- **`src/companyLookup.ts`** — The browser half of the address lookup: its own context, one page, one cache. See the cookie section below, which is the only reason this file exists separately.
- **`src/scraper/`** — The whole engine, one function per file (e.g. `scrapeJob.ts`, `runScrape.ts`, `clearBlockingOverlays.ts`), with `index.ts` as the folder's own barrel re-exporting exactly the same names `src/index.ts` re-exports from it. Splitting a function out of one of these files still means adding `export` to it and importing it by name from a sibling file — privacy is enforced entirely by what `scraper/index.ts` chooses to re-export, not by what's `export`ed at the file level. The parts that carry non-obvious reasoning:

### Load phases count unique job IDs, never DOM nodes

`scrollLoadPhase` (LinkedIn's automatic infinite scroll, batches of 10 up to 120 jobs) then `clickLoadPhase` (manual "See more jobs" clicks past that). Both measure progress via `collectJobIds()` — a `Set` of LinkedIn posting IDs — because on a long session LinkedIn's guest pagination can **re-serve an earlier page verbatim**, which raw `<li>` counting cannot distinguish from real growth. Scrolling stops the moment the "See more" button appears rather than waiting for growth to stall, since the button can appear first.

`scrollLoadPhase` scrolls exactly one `<li>` at a time, never a single jump to the bottom — LinkedIn's own lazy-load listener only reacts to genuine incremental scroll progress, and a `scrollTo(0, document.body.scrollHeight)` jump never triggers it, which used to cap every run at the ~60 jobs LinkedIn pre-renders on initial load regardless of how many results actually existed (GitHub issue #10). Before scrolling starts, it hides the page sections LinkedIn renders above the job list so each `<li>`'s own rendered height is the exact pixel distance to the next one — see the Testing section below for how this was verified live and a live-only bug it caught.

### Overlays can appear at any moment, including mid-click

LinkedIn's guest pages block clicks behind `.modal__overlay--visible` (cookie consent on load, a "sign in to view more jobs" nag later). `clearBlockingOverlays` polls rather than checking once, and only concludes "clear" after several consecutive not-visible reads. `clickWithOverlayRetries` uses short click attempts with an overlay clear between each, because a single long `click()` can get stuck retrying against an overlay that appeared while Playwright was inside its own retry loop.

The overlay selector stays narrow (`.modal__overlay--visible`) on purpose — a broader `[role="dialog"]`/`[role="alert"]` also matches always-visible accessibility live-regions earlier in the DOM, which made `.first()` pick the wrong element.

### Staleness and the single retry pass

LinkedIn's detail pane sometimes doesn't re-render when cards are clicked quickly: the title link updates but the rest of the pane is left over from the previous job. Two flags catch this per job — `companyMismatch` (list-pane company vs. detail-pane company disagree) and `lateOverlayDetected` (an overlay was visible right when data was read). `isStaleResult()` folds both into one predicate, and it excludes `status: 'failed'` implicitly because the catch block forces both flags false on failure.

`companyMismatch` only compares company text, so it has a blind spot: a pane left over from an *earlier posting at the same company* reads as a match and is never flagged. `descriptionText` and `tags` both come from that same unguarded pane read, so a stale same-company pane can silently carry the earlier job's description/tags. A deeper fix would need a detail-pane job-ID marker to compare against, not just company text — not implemented, since no such marker has been identified in the detail pane yet.

Stale jobs get **exactly one** retry, deferred until the whole list has been scraped once (`retryStaleJobs`) — by then the page has settled, and the extra pre-click delay doesn't compound into every job. `scrapeJobAndRecord` writes `results[index] = result` (indexed write, not `push`) precisely so a retry replaces rather than appends.

### Identity reads are bounded, concurrent, and individually recoverable

`readJobIdentity` reads five things off the list item (title, list company, `data-entity-urn`, job href, company href) in one `Promise.all`. Three properties there are load-bearing:

- **Every read carries an explicit `{ timeout: 1000 }`.** Playwright's default is 30s and its `getAttribute`/`innerText` auto-wait for the element, so an unbounded read turns one renamed class into ~30s of dead wait *per job* — an hour on a 120-job run, with nothing surfaced.
- **Every read has its own `.catch(() => null)`.** An unguarded rejection takes down the whole identity, including the `sourceUrl` that is specifically supposed to survive a later failure.
- **They're concurrent** because they have no data dependency on each other; sequentially, the degenerate all-missing case costs 5× the timeout.

`sourceJobId` prefers `data-entity-urn` but falls back to the trailing ID in `sourceUrl`. That fallback matters more than it looks: a null `sourceJobId` silently disables duplicate detection *and* makes `waitForJobDetailToLoad` skip its detail-pane wait entirely — which is the exact condition that manufactures stale results. Two independent carriers of the same ID means one attribute rename doesn't take both mechanisms down.

### Duplicates are marked, not dropped

`registerJobOccurrence` maps a posting ID to the index of its **first** occurrence and must never repoint that map — later occurrences and the retry pass (which re-scrapes a job at its own index and must not see itself as a duplicate) all have to resolve to the same first index. Duplicates are still scraped in full; the caller decides whether to show them.

### Progress events

`onProgress` receives a `ScrapeProgressEvent` union: `jobs:loading` (unique count grew during loading), `jobs:found` (loading done, total about to be scraped), `job:start`, and then **either** `job:done` **or** `job:stale` per job — never both. A retry re-emits for the same index.

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

`tsconfig.json` sets `"lib": ["es2023"]` with **no** `dom`, so this compiles cleanly as a Node library without leaking browser globals into consumers' type space. The cost: code inside `page.evaluate()` (which runs in the browser) has no DOM types, so `collectJobIds`, `hidePageSectionsAboveJobList`, and `scrollToListItem` name the handful of members they use through a structural `globalThis as unknown as {...}` cast. Don't "fix" those casts by adding `"dom"` to `lib`.

Related trap: `page.evaluate` serializes its callback with `toString()`, so it **cannot close over module imports**. `JOB_LIST_SELECTOR` is therefore hardcoded literally inside `collectJobIds` and `scrollToListItem`, and `COMPANY_LOCATION_ITEM_SELECTOR`/`COMPANY_PRIMARY_TAG_SELECTOR` inside `readRawLocations`, in addition to living in `selectors.ts`. All copies are commented; keep them in sync.

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
