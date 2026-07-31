# linkedin-job-scraper

Playwright-driven scraper for LinkedIn's public/guest job search results (no login required). Loads all jobs on a search via infinite scroll and "See more jobs" pagination, then scrapes title/company/description for every job card, follows each card's company link to collect that company's office addresses, and detects duplicates and stale results along the way.

Every search parameter is caller-supplied — there are no fixed defaults for location, date posted, experience level, job type, etc. Every engine timing/retry constant is likewise overridable.

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

Every engine tuning constant (browser `headless`/`viewport`, scroll/click retry limits, inter-job delay, overlay-clear timing) is optional and defaults to this package's own historically-working values — nothing is hardcoded inside the engine. `maxJobs` caps how many of the loaded jobs actually get *scraped* — the load/discovery phase (scroll + "See more") always runs to completion first and is unaffected; only the scrape loop afterward stops early. Omitted (the default) scrapes every job found.

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

## Return value: `ScrapeOutcome`

`runScrape` resolves once every job has been scraped and the browser it launched has been closed. It never resolves partially — if the run throws, nothing is returned. Collect partial data from `onProgress` as the run goes, or, for a cancelled run specifically, from the thrown `ScrapeAbortedError` itself (see [Cancellation](#cancellation) below).

```ts
interface ScrapeOutcome {
  results: JobResult[];
  url: string; // the exact LinkedIn guest search URL that was loaded
}
```

`results` holds one entry per job actually scraped, ordered by list position — `results[i].index === i`. That's the full search count, or `scraperOptions.maxJobs` when it's set and smaller. Nothing is filtered out: duplicates and failed scrapes (including a list item with no `<h3>`, which isn't a real job card) all keep their slot, and a stale job that was retried appears once, at its own index, holding the retry's result.

```ts
interface JobResultBase {
  index: number;                    // position in the loaded list
  companyMismatch: boolean;         // list-pane company disagreed with detail-pane company
  sourceJobIdMismatch: boolean;     // detail pane's own job ID disagreed with the clicked job's
  lateOverlayDetected: boolean;     // a sign-in overlay was visible when this job's data was read
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

type JobResult = SuccessfulJobResult | FailedJobResult;

interface CompanyAddress {
  streetAddress: string | null;     // street line(s) as printed, joined with ', '
  city: string | null;
  postalCode: string | null;        // region + postal together, e.g. 'Hessen 60313' or 'WA 98104'
  countryCode: string | null;       // ISO-3166 alpha-2, uppercased
}
```

Field notes worth knowing before you consume this:

- **`status`** — `JobResult` is a union of `SuccessfulJobResult` and `FailedJobResult`, and the two have different shapes: narrow on `status` before reading anything else. `'success'` means the card was clicked and the detail pane was read (that does *not* by itself mean the data is trustworthy; see `companyMismatch`/`sourceJobIdMismatch`/`lateOverlayDetected` below) — every content field is guaranteed present. `'failed'` means `scrapeJob()` threw somewhere along the way; `error` (only present on this variant) carries the thrown message, and every other content field holds whatever was captured before the failure — `null` if the failure happened before that particular field was ever read. `company`/`descriptionText`/`companyAddresses`/`tags` are always `null` on a failed result, since they're only read after everything else.
- **`title`** — `string` on a successful result (`scrapeJob()` throws if it can't be read); `string | null` on a failed one.
- **`companyMismatch` / `sourceJobIdMismatch` / `lateOverlayDetected`** — the three staleness signals, present on both variants (always `false` on a failed result). `companyMismatch` catches the list-pane company disagreeing with the detail-pane company; `sourceJobIdMismatch` catches the narrower case that slips past it — a detail pane left over from an *earlier posting at the same company*, detected by comparing the detail pane's own title-link job ID against the clicked job's `sourceJobId`. Pass the result to the exported `isStaleResult(result)` rather than testing them by hand; it folds all three into one predicate, only returns `true` for a `'success'` result, and is the same check the engine used to decide whether to retry. A result still flagged after the run means the retry didn't clear it — treat its `company`/`descriptionText` as possibly belonging to the previously-viewed job.
- **`sourceUrl` / `sourceHostname` / `scrapedAt`** — `sourceUrl` is the absolute URL of the individual job posting (each job has its own; it is not the search URL). It's scraped directly from the job list item's own link before the card is even clicked — LinkedIn's guest search re-renders the detail pane client-side on click, so `page.url()` never changes and can't be used for this — and then normalized: resolved against the search page URL and stripped of LinkedIn's per-session `refId`/`trackingId`/`position` query string, so the same posting produces the same URL on every run and is safe to dedupe or upsert on. Because it's captured before the click, it survives a later click/detail-pane failure — a `'failed'` result still carries it, unless the failure happened before it was read (in which case it's `null`, along with `sourceHostname`). `sourceHostname` is `sourceUrl`'s hostname; LinkedIn serves individual postings from country-specific subdomains, so it can differ across jobs in the same run. `scrapedAt` is always set, on both variants.
- **`duplicateOfIdx`** — LinkedIn's guest pagination can re-serve an earlier page verbatim. Repeats are scraped in full and only marked: `null` on first (and only) occurrences, otherwise the index of the first job with the same `sourceJobId`. Filter on `duplicateOfIdx === null` if you want each posting once. It stays `null` whenever `sourceJobId` is `null`, since identity can't be established — including on a `'failed'` result whose failure happened before identity was read.
- **`companyUrl`** — the hiring company's LinkedIn page, read from the card's company link and normalized the same way `sourceUrl` is (resolved against the search URL, `?trk=` tracking stripped). Like `sourceUrl` it's captured before the click, so a `'failed'` result still carries it unless the failure preceded that read. It's also the key the run's address cache uses — deliberately not the company's display name, which LinkedIn abbreviates in the list ("Slalom" for `slalom-consulting`) in ways that collide between unrelated companies.
- **`companyAddresses`** — office addresses from that company page, **with the address LinkedIn tags "Primary" at index 0**, present only on a `'success'` result (always `null` on `'failed'`). `null` and `[]` mean different things on success: `[]` means the page was read and the company publishes no address, while `null` means no lookup happened or it failed (no `companyUrl`, a blocked page, a navigation error) — unlike everything else on `JobResult`, a failed company-page lookup does **not** fail the job; it's the one field that stays nullable on a successful result on purpose. **Expect roughly 70% of companies to return addresses** — the rest genuinely publish none on their guest page. That is normal, not a bug. A run where *nothing* comes back is a different signal; see the note on cookies below.
- **`location`** — the list card's location span, scraped verbatim with no parsing. Read at the same point as `sourceUrl`/`companyUrl`, so a `'failed'` result still carries it unless the failure preceded that read.
- **`postedAt`** — the list card's posting date, taken from the `datetime` attribute (e.g. `'2026-07-21'`) rather than the relative display text ("5 days ago"), which goes stale the moment it's stored. Read and captured the same way as `location`.
- **`tags`** — the *values* (not the labels) from the detail pane's job-criteria list: seniority level, employment type, job function, industries, in whatever order LinkedIn renders them. Present only on a `'success'` result (always `null` on `'failed'`); `[]` means the detail pane was read and the job genuinely lists no criteria.

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

Aborting doesn't stop `runScrape` mid-job — it stops at the next safe checkpoint (between jobs, or during the job-loading scroll/click polling loops), then always closes the browser via `runScrape`'s own cleanup before rejecting. The rejection is a `ScrapeAbortedError`, not a resolved `ScrapeOutcome`: `error.name === 'AbortError'` (the same convention `fetch` uses) tells a cancelled run apart from any other failure, and `error.partial: ScrapeOutcome` carries whatever `results`/`url` had already been collected at that checkpoint — `results` is `[]` if the signal was already aborted before the run started or during job loading, before any job was scraped.

## Progress events

`onProgress` is optional. When passed, it's called synchronously with a `ScrapeProgressEvent` — a union discriminated on `type`:

```ts
type ScrapeProgressEvent =
  | { type: 'jobs:loading'; count: number }
  | { type: 'jobs:found'; total: number }
  | { type: 'job:start'; index: number; total: number }
  | { type: 'job:done'; result: JobResult }
  | { type: 'job:stale'; result: JobResult };
```

- `jobs:loading` — the unique job count changed during the scroll/click loading phase (in practice, grew). `count` is the number of distinct posting IDs currently in the list, not a delta; it fires several times per run, and not at all if loading never makes progress. Not capped by `maxJobs` — loading always discovers the full search before scraping starts, so `count` here can exceed the `total` reported next.
- `jobs:found` — loading finished; `total` is the number of jobs about to be scraped and is final for the run. Reflects `scraperOptions.maxJobs` when set.
- `job:start` — about to scrape the job at `index` (0-based) out of `total`.
- `job:done` — a job finished scraping and the result looks trustworthy. This is also the event a `status: 'failed'` job emits — check `result.status`, don't assume done means scraped.
- `job:stale` — a job finished scraping but `isStaleResult(result)` is true: the scrape succeeded, yet the detail-pane company disagreed with the list, the detail pane's own job ID disagreed with the clicked job's, or a sign-in overlay was still visible when the data was read. Emitted *instead of* `job:done` for that job, never both.

Each job emits exactly one `job:start`, then exactly one of `job:done`/`job:stale`. Stale jobs get a single retry pass after the whole list has been scraped once, which re-emits the full trio for the same `index` — so a caller keying on `index` should overwrite, not append, and `total` is an upper bound on progress rather than an event count. `result` is the same object written into `outcome.results[index]`.

Because the union is discriminated, a `switch (event.type)` narrows each branch:

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

## Notes

- Guest/unauthenticated view only — no login, no credentials.
- LinkedIn's markup and anti-bot gating can change or vary by session; this scrapes an unofficial, moving surface.
- `runScrape` launches and closes its own Chromium browser per call, and opens **two** contexts inside it: one for the search, one for company pages. The company context clears its cookies before every navigation — LinkedIn only serves the "Locations" section to a cookie jar that hasn't already seen a company page, so without this the second company onwards silently comes back with no addresses. If a whole run returns empty `companyAddresses`, suspect that mechanism rather than assuming LinkedIn dropped the data.
- Company pages must be genuinely navigated to; LinkedIn answers `fetch()` for them with HTTP 999.
- Expect the run to take noticeably longer than a job-only scrape: one extra page load per distinct company (a 60-job search typically covers ~54).
