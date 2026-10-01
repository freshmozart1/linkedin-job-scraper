# linkedin-job-scraper

Playwright-driven scraper for LinkedIn's public/guest job search results (no login required). Loads jobs via infinite scroll and "See more jobs" pagination, then scrapes title/company/description once per distinct posting, follows each posting's company link to collect that company's office addresses, and detects stale results along the way.

Every search parameter is caller-supplied — there are no fixed defaults for location, date posted, experience level, job type, etc. Every engine timing/retry constant is likewise overridable.

## Contents

- [Usage](#usage)
- [`SearchParams`](#searchparams)
- [`ScraperOptions`](#scraperoptions)
  - [Time budgets](#time-budgets)
  - [Stale diagnostics](#stale-diagnostics)
- [Return value: `ScrapeOutcome`](#return-value-scrapeoutcome)
  - [Field reference](#field-reference)
  - [`companyAddresses` shape](#companyaddresses-shape)
- [Cancellation](#cancellation)
- [Progress events](#progress-events)
- [URL helpers](#url-helpers)
- [Address helpers](#address-helpers)
- [Building from source](#building-from-source)
- [Notes](#notes)

## Usage

```ts
import { runScrape } from 'linkedin-job-scraper';

const outcome = await runScrape({
  searchParams: {
    keywords: 'Frontend Developer',
    location: 'Berlin, Germany',
    datePosted: 'week',
    experienceLevels: ['entry', 'mid-senior'],
    jobTypes: ['full-time'],
    workplaceTypes: ['remote', 'hybrid'],
  },
  scraperOptions: {
    headless: true,
    maxScrollAttempts: 30,
  },
  onProgress: (event) => {
    console.log(event);
  },
});

console.log(outcome.results); // JobResult[]
console.log(outcome.url);    // the LinkedIn search URL that was scraped
```

## `SearchParams`

Only `keywords` is required. Everything else (`location`, `geoId`, `datePosted`, `experienceLevels`, `jobTypes`, `workplaceTypes`, `distanceMiles`, `sortBy`) is optional and, when omitted, simply isn't sent as a query param. An `extraParams` escape hatch lets callers pass any LinkedIn query param not explicitly modeled.

## `ScraperOptions`

Every engine tuning constant (browser `headless`/`viewport`, scroll/click retry limits, inter-job delay, overlay-clear timing) is optional and defaults to this package's own historically-working values — nothing is hardcoded inside the engine. `maxJobs` caps how many distinct loaded postings actually get *scraped* — after deduplication and in first-list-occurrence order. The load/discovery phase (scroll + "See more") always reaches its own explicit-end, stability, abort, or safety-bound condition first and is unaffected by `maxJobs`; only the scrape loop afterward is capped. Omitted (the default) scrapes every distinct posting loaded within those bounds.

During discovery, `stableScrollsToStop` and `stableClicksToStop` count consecutive scroll reads or clicks where neither the unique-job count nor the raw rendered-list count progresses. LinkedIn sometimes appends overlapping batches made entirely of duplicate IDs; those rows are allowed to advance pagination without inflating `jobs:loading` or the final unique total. `maxScrollAttempts` and `maxSeeMoreClicks` remain the defensive bounds if raw duplicate rows continue arriving indefinitely.

`shouldScrapeJob(identity)` is a pre-click filter: called with a job card's list-level identity — `title`, `sourceUrl`, `sourceHostname`, `sourceJobId`, `companyUrl`, `location`, `postedAt` (see `JobCardIdentity`) — right after it's read off the card, but *before* the card is clicked. Return `false` to skip that job's full detail scrape entirely (no click, no company lookup) and record a `status: 'skipped'` result at that index instead. Omitted (the default), every job is scraped as before.

```ts
scraperOptions: {
  shouldScrapeJob: (identity) => !identity.title.includes('Senior'),
}
```

Must be synchronous — the return value is checked directly, so a `Promise` (from an `async` function) is always truthy and the skip branch would never fire. Resolve any async work (e.g. against your own database) before calling `runScrape`.

Normally called once per distinct posting, but a job whose first pass came back `'success'` yet stale, or failed because the detail pane never proved its identity, gets exactly one deferred retry. That pass consults this callback again — a stateful predicate can see the same job twice with different answers, and a retry that flips to `false` replaces the earlier result with an empty `'skipped'` one.

### Time budgets

Two optional wall-clock caps bound how long a scrape can take. Both are off-by-default in spirit — the per-job one has a default generous enough that an honest job never notices it, and the run-level one has no default at all.

`perJobTimeoutMs` (default `45000`) is the budget for one job's entire scrape. Every individual Playwright wait below `scrapeJob` — the card scroll, the click ladder, the overlay clears, the detail-pane wait, each field read, and the company-page lookup — is clamped to whatever is left of it, so it bounds *real elapsed* time rather than only being checked between steps. Without it those waits stack past 100 seconds for a single blocked job, and a run scrapes every job in sequence, so one systematically blocked card could make a 30-job run spend the better part of an hour producing nothing.

A job that blows its budget is abandoned and recorded as:

```ts
{
  status: 'failed',
  error: 'Job exceeded per-job time budget of 45000ms',
  // plus whatever identity was read off the list card before time ran out:
  // title / sourceJobId / sourceUrl / sourceHostname / companyUrl / location / postedAt
}
```

It emits the usual `job:done`, keeps its slot in `results`, and the run moves on to the next job. It is **not** retried — a job that blew its budget is usually blocked by something run-wide (an overlay, a rate limit), so an immediate retry mostly doubles the cost. `0` or a negative value disables the budget entirely, following Playwright's own "0 means no timeout" convention.

`maxRunDurationMs` is the budget for the whole run, browser startup included. There is no default: omitted, a run takes as long as its jobs take. When it runs out the run stops at the next checkpoint — the same ones a `signal` abort stops at — and `runScrape` **resolves** with the results gathered so far plus `stoppedEarly: 'run-time-budget'` (see [`ScrapeOutcome`](#return-value-scrapeoutcome)). A budget the caller asked for is an expected outcome, not a failure, which is why it resolves rather than rejecting the way an abort does. A `signal` abort always wins when both are true. `0`, a negative value, `Infinity` and `NaN` all mean "no run budget".

```ts
scraperOptions: {
  perJobTimeoutMs: 45000,     // default; 0 disables
  maxRunDurationMs: 15 * 60 * 1000,
}
```

`overlayClear` groups the settings for the blocking-overlay ladder. LinkedIn's guest pages put a `.modal__overlay--visible` over the job list (cookie consent on load, a "sign in to view more jobs" nag later) that intercepts every click. Each round against a still-visible overlay reads it once, clicks the best control it can find (never *Sign in* / *Join now* — navigating off the search page loses the rest of the run), and presses `Escape`; once `maxDismissAttempts` rounds have failed, the overlay is neutralized outright so the run continues instead of stalling:

```ts
scraperOptions: {
  overlayClear: {
    timeoutMs: 15000,               // budget for the clear right after the search page loads
    pollIntervalMs: 300,            // gap between polls
    requiredConsecutiveClear: 5,    // not-visible reads needed before concluding "clear"
    maxDismissAttempts: 2,          // failed click+Escape rounds before neutralizing; 0 neutralizes immediately
    neutralizeStuckOverlay: true,   // allow the last-resort DOM mutation at all
  },
}
```

The three timing fields apply only to that first clear — every later clear (before each job-card click, after it, and once more right after the detail pane is read) keeps its own tighter budget, since each has its own point in the job. `maxDismissAttempts` and `neutralizeStuckOverlay` are the tier *policy* and do apply everywhere. Set `neutralizeStuckOverlay: false` to leave the page untouched and accept a failed job (`Blocked by LinkedIn sign-in wall (could not dismiss dialog): …`, with the overlay diagnostics appended) instead.

`companyLookup` groups the settings for the company-address pass:

```ts
scraperOptions: {
  companyLookup: {
    navigationTimeoutMs: 20000,    // per company page load
    emptyRetries: 1,               // extra attempts when an attempt yields no addresses: no Locations section, an authwall bounce, or a navigation error
    delayBetweenLookupsMs: 900,    // pause after a lookup that hit the network; cache hits skip it
    maxAddressesPerCompany: 10,    // default: uncapped — some companies publish 100+
  },
}
```

### Stale diagnostics

Every considered list index is recorded, including failed and pre-click-skipped jobs, and retry attempts are retained as separate records. The run's records are aggregated into [`ScrapeOutcome.staleReport`](#return-value-scrapeoutcome). Diagnostics observe the recovery policy; turning diagnostics off does not change identity gating, waits, retries, or staleness flags.

```ts
scraperOptions: {
  staleDiagnostics: {
    enabled: true,             // default; false skips collection entirely
    domSnapshot: false,        // default; capture the detail pane's markup for flagged jobs
    snapshotEveryJob: false,   // default; snapshot healthy jobs too, as a baseline
    maxSnapshotChars: 4000,    // default; cap applied in the browser
  },
}
```

Collection is on by default because everything but the snapshot is a value the scrape already computed — timestamps, booleans, strings it read anyway — so it costs no extra browser round-trips. `domSnapshot` is off by default because it is one extra `page.evaluate` per captured job, and it is the only part that does.

Each `StaleDiagnostics` record names its `runId`, `totalJobs`, pass and final `resultStatus`; compares the clicked card's identity with what the pane showed; and carries ordered `detailIdentityChecks` for the initial activation and optional immediate re-click. Each check retains the expected ID, observed href and parsed ID, exact-match result, and wait timing. The record also carries read timings and an `overlayChecks` timeline for every pre-click, post-click and late clear. Snapshot capture reports `not-requested`, `captured`, `skipped-budget` or `failed`, with an error for failures, so missing evidence is attributable. The same record is attached to that job's `job:done` / `job:stale` event.

`summarizeStaleDiagnostics` and `describeStaleReport` are exported and pure, so several runs' records can be concatenated and re-summarized as one:

```ts
import { summarizeStaleDiagnostics, describeStaleReport } from 'linkedin-job-scraper';

const combined = summarizeStaleDiagnostics([...runA.records, ...runB.records]);
console.log(describeStaleReport(combined));
```

Headline counts, flag combinations, positions and `StaleReport.conditions` use successful first-pass jobs only: a retry is evidence about recovery, not another job in the denominator, and a failed result is never stale. Retry records remain available under `records` and in `retriesAttempted` / `retriesRecovered`; `identityRecovery` separately counts immediate re-clicks that were attempted, recovered, or failed. Run boundaries come from `runId`, halves from `totalJobs`, and predecessor conditions only from the exact preceding index.

`scripts/diagnose-stale.ts` drives all of this against the live site. It is not part of the published package:

```bash
npx tsx scripts/diagnose-stale.ts --runs 3 --keyword "software engineer" --location Berlin --jobs 30
```

It writes one collision-proof JSON per run and keyword plus a combined JSON report under `diagnostics/`, and prints the combined report at the end.

## Return value: `ScrapeOutcome`

`runScrape` resolves once every job has been scraped and the browser it launched has been closed. If the run throws, nothing is returned — collect partial data from `onProgress` as the run goes, or, for a cancelled run specifically, from the thrown `ScrapeAbortedError` itself (see [Cancellation](#cancellation) below). The one case that resolves *without* every job having been scraped is `scraperOptions.maxRunDurationMs` running out, which is flagged by `stoppedEarly`.

```ts
interface ScrapeOutcome {
  results: JobResult[];
  url: string; // the exact LinkedIn guest search URL that was loaded
  stoppedEarly?: 'run-time-budget';
  staleReport?: StaleReport;
}
```

`staleReport` is absent only when [`staleDiagnostics.enabled`](#stale-diagnostics) is `false`; an enabled run that scraped nothing still reports an empty one, so "collected nothing" stays distinguishable from "nobody asked". It is attached to the `stoppedEarly` return too — a run that stopped short still observed everything it got through.

`stoppedEarly` is absent on a run that scraped every job it found — which is every run that doesn't set [`maxRunDurationMs`](#time-budgets). It is `'run-time-budget'` when that budget ran out first, in which case `results` is short of the `total` reported by `jobs:found` (and is `[]` when the budget expired during the job-loading phase, before any job was scraped or `jobs:found` was even emitted). Existing consumers are unaffected: the field is additive, and a run without a run budget can never set it.

Otherwise `results` holds one entry per distinct posting ID, ordered by its first list occurrence, with contiguous logical indices — `results[i].index === i`. That's the unique discovered count, or `scraperOptions.maxJobs` when it's set and smaller. Duplicate raw cards are removed before traversal; failed scrapes, jobs abandoned on `perJobTimeoutMs`, and jobs `shouldScrapeJob` skipped without ever being clicked keep their logical slot. A card whose posting ID cannot be parsed is retained individually so its identity failure remains visible instead of disappearing. A stale result or detail-identity failure selected for the deferred retry appears once, at its own index, holding the retry's replacement result.

```ts
interface JobResultBase {
  index: number;                    // logical position among distinct loaded postings
  companyMismatch: boolean;         // list-pane company disagreed with detail-pane company
  sourceJobIdMismatch: boolean;     // detail pane's own job ID disagreed with the clicked job's
  lateOverlayDetected: boolean;     // an overlay was over the pane when this job's data was read, however it was then closed
  scrapedAt: string;                // ISO-8601 timestamp, new Date().toISOString()
  duplicateOfIdx: number | null;    // index of the first job with this posting ID, else null
}

// A job card that was fully scraped.
interface SuccessfulJobResult extends JobResultBase {
  status: 'success';
  title: string;
  company: string;                  // read from the detail pane
  descriptionText: string;
  sourceJobId: string;              // LinkedIn's numeric posting ID
  sourceUrl: string;                // absolute URL of this job posting, normalized (see below)
  sourceHostname: string;           // sourceUrl's hostname, e.g. de.linkedin.com (varies per job)
  companyUrl: string;               // absolute URL of the company's LinkedIn page, normalized
  companyAddresses: CompanyAddress[] | null;  // primary address first; see below
  location: string;                 // list card's location text, scraped verbatim
  postedAt: string;                 // list card's posting date (datetime attribute, e.g. '2026-07-21')
  tags: string[];                   // detail pane's job-criteria values (seniority, employment type, job function, industries)
}

// A job card whose scrape threw before finishing. Every field below `error`
// holds whatever was captured before the failure — null if the failure
// happened before that particular read.
interface FailedJobResult extends JobResultBase {
  status: 'failed';
  error: string;                    // the thrown error's message
  failureReason?: 'detail-pane-identity-unverified';
  title: string | null;
  company: null;
  descriptionText: null;
  sourceJobId: string | null;
  sourceUrl: string | null;
  sourceHostname: string | null;
  companyUrl: string | null;
  companyAddresses: null;
  location: string | null;
  postedAt: string | null;
  tags: null;
}

// A job card whose full detail scrape never ran because shouldScrapeJob
// returned false for it. Every field inherited from JobCardIdentity below
// is exactly what was read off the card before the callback was consulted
// — nothing from the detail pane or the company lookup was ever read,
// since the card was never clicked.
interface SkippedJobResult extends JobResultBase {
  status: 'skipped';
  title: string;
  company: null;
  descriptionText: null;
  sourceJobId: string;
  sourceUrl: string;
  sourceHostname: string;
  companyUrl: string;
  companyAddresses: null;
  location: string;
  postedAt: string;
  tags: null;
}

type JobResult = SuccessfulJobResult | FailedJobResult | SkippedJobResult;

interface CompanyAddress {
  streetAddress: string | null;     // street line(s) as printed, joined with ', '
  city: string | null;
  postalCode: string | null;        // region + postal together, e.g. 'Hessen 60313' or 'WA 98104'
  countryCode: string | null;       // ISO-3166 alpha-2, uppercased
}
```

### Field reference

Field notes worth knowing before you consume this.

#### `status`

`JobResult` is a union of `SuccessfulJobResult`, `FailedJobResult`, and `SkippedJobResult` with different shapes — narrow on `status` before reading anything else.

- `'success'` means the card was clicked, its detail title-link ID exactly matched the card's `sourceJobId`, and the detail pane was then read. Other staleness signals can still flag the result, but a known predecessor pane is never returned as a trusted success.
- `'failed'` means `scrapeJob()` threw somewhere along the way; `error` carries the message, and `failureReason` is `'detail-pane-identity-unverified'` when both the initial activation and one immediate re-click failed the identity gate. Detail-derived fields stay `null` in that case. Other failures omit `failureReason`.
- `'skipped'` means `scraperOptions.shouldScrapeJob` returned `false` for this card's list-level identity — the card was never clicked. `title`/`sourceJobId`/`sourceUrl`/`sourceHostname`/`companyUrl`/`location`/`postedAt` are exactly what was read off the list card; `error` is not present on this variant (it isn't a failure).
- `company`/`descriptionText`/`companyAddresses`/`tags` are always `null` on a failed or skipped result, since they're only read after everything else.

#### `title`

- `string` on a successful result (`scrapeJob()` throws if it can't be read).
- `string | null` on a failed one.

#### Staleness flags — `companyMismatch`, `sourceJobIdMismatch`, `lateOverlayDetected`

The three staleness signals, present on both variants (always `false` on a failed result).

- `companyMismatch` catches the list-pane company disagreeing with the detail-pane company.
- `sourceJobIdMismatch` remains a defense against the pane changing after the identity gate and before the final title-link read. A pane that is already mismatched at the gate is re-clicked once and then fails explicitly instead of reaching these fields.
- `lateOverlayDetected` catches a blocking overlay sitting over the pane around the moment its data was read — **however that overlay was eventually got rid of.** It is `true` for one that was dismissed by a click or by `Escape`, one that had to be forcibly neutralized, and one that was still blocking when the clear gave up alike. That is wider than it used to be: before the escalation ladder landed, the flag only meant "an overlay was *still there* after the clear failed". Reading it as "the page was blocked" now under-reports — an overlay that renders over the pane and is then closed cleanly can still have covered the read, and the read is what this flag is about. The practical consequence is that a run whose overlays are being dismissed successfully will flag more jobs than the same run did before, and each of those jobs gets the one retry a stale result is entitled to rather than being kept as trustworthy.
- Pass the result to the exported `isStaleResult(result)` rather than testing them by hand; it folds all three into one predicate, only returns `true` for a `'success'` result, and is the same check the engine used to decide whether to retry.
- A result still flagged after the run means the retry didn't clear it — treat its `company`/`descriptionText` as possibly belonging to the previously-viewed job.

#### Source identity — `sourceUrl`, `sourceHostname`, `scrapedAt`

`sourceUrl` is the absolute URL of the individual job posting (each job has its own; it is not the search URL).

- Scraped directly from the job list item's own link before the card is even clicked — LinkedIn's guest search re-renders the detail pane client-side on click, so `page.url()` never changes and can't be used for this.
- Normalized: resolved against the search page URL and stripped of LinkedIn's per-session `refId`/`trackingId`/`position` query string, so the same posting produces the same URL on every run and is safe to dedupe or upsert on.
- Because it's captured before the click, it survives a later click/detail-pane failure — a `'failed'` result still carries it, unless the failure happened before it was read (in which case it's `null`, along with `sourceHostname`).
- `sourceHostname` is `sourceUrl`'s hostname; LinkedIn serves individual postings from country-specific subdomains, so it can differ across jobs in the same run.
- `scrapedAt` is always set, on both variants.

#### `duplicateOfIdx`

`runScrape` removes repeated posting IDs before traversal, so ordinary results normally report `null` here. The field remains for compatibility and for direct callers of the lower-level `scrapeJob` / `scrapeAllJobsOnce` APIs, which deliberately retain raw-index behavior.

- `null` on first (and only) occurrences; otherwise the raw index of the first job with the same `sourceJobId` for a direct low-level traversal.
- `runScrape` already returns each parsed posting once; no consumer-side duplicate filter is needed.
- Stays `null` whenever `sourceJobId` is `null`, since identity can't be established — including on a `'failed'` result whose failure happened before identity was read.
- A `'skipped'` result is never itself registered as the "first occurrence" of its `sourceJobId` — a later occurrence of the same posting that *does* get scraped will not point back at a skipped one. But a skipped result still reports `duplicateOfIdx` against an *earlier* index that already scraped the same posting, if there was one.

#### `companyUrl`

The hiring company's LinkedIn page, read from the card's company link and normalized the same way `sourceUrl` is (resolved against the search URL, `?trk=` tracking stripped).

- Like `sourceUrl`, it's captured before the click, so a `'failed'` result still carries it unless the failure preceded that read.
- It's also the key the run's address cache uses — deliberately not the company's display name, which LinkedIn abbreviates in the list ("Slalom" for `slalom-consulting`) in ways that collide between unrelated companies.

#### `companyAddresses`

Office addresses from that company page, **with the address LinkedIn tags "Primary" at index 0**, present only on a `'success'` result (always `null` on `'failed'`).

- `null` and `[]` mean different things on success: `[]` means the page was read and the company publishes no address, while `null` means no lookup happened or it failed (no `companyUrl`, a blocked page, a navigation error).
- Unlike everything else on `JobResult`, a failed company-page lookup does **not** fail the job; it's the one field that stays nullable on a successful result on purpose.
- **Expect roughly 70% of companies to return addresses** — the rest genuinely publish none on their guest page. That is normal, not a bug.
- A run where *nothing* comes back is a different signal; see the note on cookies below.

#### `location`

The list card's location span, scraped verbatim with no parsing.

- Read at the same point as `sourceUrl`/`companyUrl`, so a `'failed'` result still carries it unless the failure preceded that read.

#### `postedAt`

The list card's posting date, taken from the `datetime` attribute (e.g. `'2026-07-21'`) rather than the relative display text ("5 days ago"), which goes stale the moment it's stored.

- Read and captured the same way as `location`.

#### `tags`

The *values* (not the labels) from the detail pane's job-criteria list: seniority level, employment type, job function, industries, in whatever order LinkedIn renders them.

- Present only on a `'success'` result (always `null` on `'failed'`).
- `[]` means the detail pane was read and the job genuinely lists no criteria.

### `companyAddresses` shape

LinkedIn prints an address as up to two optional street lines plus one locality line of the form `<city>, <region> <postal>, <CC>`. Region and postal code are joined with a plain space and no separator that distinguishes them, so they stay joined in `postalCode` rather than being guessed apart:

```ts
// "Bockenheimer Anlage 46" / "Frankfurt, Hesse 60322, DE"
{ streetAddress: 'Bockenheimer Anlage 46', city: 'Frankfurt', postalCode: 'Hesse 60322', countryCode: 'DE' }

// "2 Kingdom Street" / "First Floor" / "London, England W2 6BD, GB"
{ streetAddress: '2 Kingdom Street, First Floor', city: 'London', postalCode: 'England W2 6BD', countryCode: 'GB' }

// "Wien, AT" — no street, no postal code
{ streetAddress: null, city: 'Wien', postalCode: null, countryCode: 'AT' }
```

Every field is nullable because LinkedIn omits parts freely. The one known parse limitation: a city containing commas puts its own overflow into `postalCode`, since nothing in the markup says where the city ends (1 occurrence in a 461-address sample).

## Cancellation

Pass an `AbortSignal` to stop a scrape early:

```ts
import { runScrape, ScrapeAbortedError } from 'linkedin-job-scraper';

const controller = new AbortController();
setTimeout(() => controller.abort(), 30000); // give up after 30s

try {
  const outcome = await runScrape({
    signal: controller.signal,
    searchParams: { keywords: 'Frontend Developer' },
  });
  console.log(outcome.results);
} catch (error) {
  if (error instanceof ScrapeAbortedError) {
    console.log(error.partial.results); // whatever was scraped before cancellation
  } else {
    throw error;
  }
}
```

`runScrape` itself still only *rejects* at a safe checkpoint — between jobs, or during the job-loading scroll/click polling loops — and always closes the browser via its own cleanup before it does. But the signal now reaches inside the in-flight job too, at the step boundaries of its own [time budget](#time-budgets): an abort lands within seconds instead of waiting out the ~100s a stuck job can take. That job is recorded at its own index as `status: 'failed'` with `error: 'Scrape aborted'`, carrying whatever identity was read off its list card, so the interrupted job keeps an honest slot rather than disappearing. If you persist results, treat that error as "interrupted", not as a job that genuinely failed.

The rejection is a `ScrapeAbortedError`, not a resolved `ScrapeOutcome`: `error.name === 'AbortError'` (the same convention `fetch` uses) tells a cancelled run apart from any other failure, and `error.partial: ScrapeOutcome` carries whatever `results`/`url` had already been collected at that checkpoint — `results` is `[]` if the signal was already aborted before the run started or during job loading, before any job was scraped.

A job in flight when [`maxRunDurationMs`](#time-budgets) expires is recorded the same way, but names the run's clock: `error: 'Run exceeded its <n>ms time budget'`. The run budget reaches a job as an abort signal internally, so the two would otherwise be indistinguishable from inside a job — a run that merely ran out of time would claim the caller cancelled it. The run itself then resolves with `stoppedEarly: 'run-time-budget'` rather than rejecting.

## Progress events

`onProgress` is optional. When passed, it's called synchronously with a `ScrapeProgressEvent` — a union discriminated on `type`:

```ts
type ScrapeProgressEvent =
  | { type: 'jobs:loading'; count: number }
  | { type: 'jobs:found'; total: number }
  | { type: 'job:start'; index: number; total: number }
  | { type: 'job:done'; result: JobResult; diagnostics?: StaleDiagnostics }
  | { type: 'job:stale'; result: JobResult; diagnostics?: StaleDiagnostics }
  | {
      type: 'overlay:undismissed';
      neutralized: boolean;
      diagnostics: OverlayDiagnostics | null;
    };
```

- `jobs:loading` — the unique posting count changed during the scroll/click loading phase (in practice, grew). `count` is the number of distinct posting IDs currently in the list, not a delta; raw duplicate growth resets loader stability but emits no event. Not capped by `maxJobs` — loading discovers as many cards as LinkedIn exposes before an explicit-end, stability, abort, or configured safety-bound condition, so `count` here can exceed the `total` reported next.
- `jobs:found` — loading finished; `total` is the number of distinct postings about to be scraped and is final for the run. Reflects `scraperOptions.maxJobs` when set.
- `job:start` — about to scrape the job at `index` (0-based) out of `total`.
- `job:done` — a job finished scraping and the result looks trustworthy. This is also the event a `status: 'failed'` job emits — check `result.status`, don't assume done means scraped.
- `overlay:undismissed` — a blocking overlay could not be closed by clicking a control inside it or by pressing `Escape`, so it was either forcibly neutralized (`neutralized: true` — its `--visible` modifier stripped and `pointer-events`/`visibility` forced off, which unblocks the page) or was still there when the clear gave up (`neutralized: false`). `diagnostics` carries what the overlay was — its collapsed text, its full class list, and the accessible name of every control inside it — or `null` if the read itself failed. Not tied to a job index, and *not* emitted on the ordinary path where a click or `Escape` closed the overlay: that happens on virtually every guest page load. A single stuck overlay can emit this several times for one job, since each clear site reports independently.
- `job:stale` — a job finished scraping but `isStaleResult(result)` is true: the scrape succeeded, yet the detail-pane company disagreed with the list, the detail pane's own job ID disagreed with the clicked job's, or an overlay was over the pane when the data was read (whether or not it was then closed — see `lateOverlayDetected` above). Emitted *instead of* `job:done` for that job, never both.

Both `job:done` and `job:stale` carry `diagnostics`, absent only when [`staleDiagnostics.enabled`](#stale-diagnostics) is `false`. A skipped job carries a minimal record so positions and exact predecessor relationships remain truthful, but it is excluded from stale-rate denominators.

Each job emits exactly one `job:start`, then exactly one of `job:done`/`job:stale`. Stale jobs get a single retry pass after the whole list has been scraped once, which re-emits the full trio for the same `index` — so a caller keying on `index` should overwrite, not append, and `total` is an upper bound on progress rather than an event count. `result` is the same object written into `outcome.results[index]`.

`overlay:undismissed` is the one event not tied to a job — it can fire during the initial page load and the job-loading phase as well as mid-job. Because the union is discriminated, a `switch (event.type)` narrows each branch:

```ts
onProgress: (event) => {
  switch (event.type) {
    case 'jobs:found':
      console.log(`scraping ${event.total} jobs`);
      break;
    case 'job:stale':
      console.warn(`job ${event.result.index} looked stale`);
      break;
  }
}
```

`isStaleResult` is exported so callers can apply the same classification to any `JobResult` after the fact (e.g. when inspecting `outcome.results`) without re-deriving the condition themselves.

`overlay:undismissed`'s `diagnostics` payload is an `OverlayDiagnostics`, and `describeOverlayDiagnostics` renders it to the same one-line, length-capped string a blocked job's `error` carries — exported so you can log the event in the format you'd see in a failed result, rather than re-deriving it:

```ts
import { describeOverlayDiagnostics } from 'linkedin-job-scraper';

interface OverlayDiagnostics {
  text: string;          // the overlay's own text, whitespace collapsed and length-capped
  classes: string[];     // its full class list in DOM order — which overlay variant was on screen
  buttonNames: string[]; // each control's accessible name; '' for the icon-only × close control
}

describeOverlayDiagnostics(event.diagnostics);
// 'overlay text: "Sign in to view more jobs"; classes: [modal__overlay modal__overlay--visible]; buttons: ["", "Sign in", "Join now"]'
```

It accepts `null` (rendering `overlay diagnostics unavailable`), so you can pass `event.diagnostics` straight through without narrowing it first. The read behind it uses `textContent`, not `innerText`, on purpose: an overlay whose base classes still say `invisible` reports an empty `innerText` even while it is intercepting every click.

## URL helpers

The pure functions behind `sourceUrl`/`sourceHostname`/`sourceJobId` are exported too, so you can re-derive them from a stored URL instead of trusting a persisted field:

```ts
import { normalizeJobUrl, normalizeCompanyUrl, hostnameOf, jobIdFromUrl } from 'linkedin-job-scraper';

normalizeJobUrl('/jobs/view/x-4012345678?refId=abc', 'https://de.linkedin.com/jobs/search');
// 'https://de.linkedin.com/jobs/view/x-4012345678'   — resolved, tracking params stripped
normalizeCompanyUrl('/company/yatta-solutions-gmbh?trk=public_jobs', 'https://de.linkedin.com/jobs/search');
// 'https://de.linkedin.com/company/yatta-solutions-gmbh'
hostnameOf('https://de.linkedin.com/jobs/view/x-4012345678');  // 'de.linkedin.com'
jobIdFromUrl('https://de.linkedin.com/jobs/view/x-4012345678'); // '4012345678'
```

All of them return `null` rather than throwing on input that isn't a usable LinkedIn URL.

## Address helpers

The address parser is pure and exported, so a stored company page can be re-parsed without re-scraping:

```ts
import { parseLocalityLine, parseCompanyLocation, toCompanyAddresses } from 'linkedin-job-scraper';

parseLocalityLine('Frankfurt am Main, Hessen 60313, DE');
// { city: 'Frankfurt am Main', postalCode: 'Hessen 60313', countryCode: 'DE' }

toCompanyAddresses([{ isPrimary: false, lines: ['Berlin, DE'] }, { isPrimary: true, lines: ['Dortmund, DE'] }]);
// [{ ...Dortmund }, { ...Berlin }]   — the primary is moved to index 0
```

`createCompanyLookup(browser, options)` is exported too, if you want to resolve addresses for a list of company URLs without running a job search.

## Building from source

Run `npm run build` to regenerate `dist/`. The build first removes that generated directory with a portable Node.js cleanup step, so files from removed or renamed source modules cannot shadow the current implementation. Keep hand-written files outside `dist/`.

The `prepare` lifecycle still runs the same build when this repository is installed as a Git dependency. `npm test` includes offline package-build checks for upgrading from obsolete output and preparing a fresh checkout; those tests use temporary fixtures and do not launch a browser.

## Notes

- Guest/unauthenticated view only — no login, no credentials.
- LinkedIn's markup and anti-bot gating can change or vary by session; this scrapes an unofficial, moving surface.
- `runScrape` launches and closes its own Chromium browser per call, and opens **two** contexts inside it: one for the search, one for company pages. The company context clears its cookies before every navigation — LinkedIn only serves the "Locations" section to a cookie jar that hasn't already seen a company page, so without this the second company onwards silently comes back with no addresses. If a whole run returns empty `companyAddresses`, suspect that mechanism rather than assuming LinkedIn dropped the data.
- Company pages must be genuinely navigated to; LinkedIn answers `fetch()` for them with HTTP 999.
- Expect the run to take noticeably longer than a job-only scrape: one extra page load per distinct company (a 60-job search typically covers ~54).
