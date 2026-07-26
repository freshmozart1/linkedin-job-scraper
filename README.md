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

Every engine tuning constant (browser `headless`/`viewport`, scroll/click retry limits, inter-job delay, overlay-clear timing) is optional and defaults to this package's own historically-working values — nothing is hardcoded inside the engine.

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

`runScrape` resolves once every job has been scraped and the browser it launched has been closed. It never resolves partially — if the run throws, nothing is returned, so wrap the call if you want to keep partial data (collect it from `onProgress` instead).

```ts
interface ScrapeOutcome {
  results: JobResult[];
  url: string; // the exact LinkedIn guest search URL that was loaded
}
```

`results` holds one entry per job card found on the search, ordered by list position — `results[i].index === i`. Nothing is filtered out: duplicates, skipped non-job list items, and failed scrapes all keep their slot, and a stale job that was retried appears once, at its own index, holding the retry's result.

```ts
interface JobResult {
  index: number;                    // position in the loaded list
  title: string | null;
  company: string | null;           // read from the detail pane
  descriptionText: string | null;
  status: 'success' | 'skipped' | 'failed';
  error: string | null;             // set when status is 'skipped' or 'failed'
  companyMismatch: boolean;         // list-pane company disagreed with detail-pane company
  lateOverlayDetected: boolean;     // a sign-in overlay was visible when this job's data was read
  sourceJobId: string | null;       // LinkedIn's numeric posting ID
  sourceUrl: string | null;         // absolute URL of this job posting, normalized (see below)
  sourceHostname: string | null;    // sourceUrl's hostname, e.g. de.linkedin.com (varies per job)
  scrapedAt: string;                // ISO-8601 timestamp, new Date().toISOString()
  duplicateOfIdx: number | null;    // index of the first job with this posting ID, else null
  companyUrl: string | null;        // absolute URL of the company's LinkedIn page, normalized
  companyAddresses: CompanyAddress[] | null;  // primary address first; see below
  location: string | null;          // list card's location text, scraped verbatim
  postedAt: string | null;          // list card's posting date (datetime attribute, e.g. '2026-07-21')
  tags: string[] | null;            // detail pane's job-criteria values (seniority, employment type, job function, industries)
}

interface CompanyAddress {
  streetAddress: string | null;     // street line(s) as printed, joined with ', '
  city: string | null;
  postalCode: string | null;        // region + postal together, e.g. 'Hessen 60313' or 'WA 98104'
  countryCode: string | null;       // ISO-3166 alpha-2, uppercased
}
```

Field notes worth knowing before you consume this:

- **`status`** — `'success'` means the card was clicked and the detail pane was read (that does *not* by itself mean the data is trustworthy; see `companyMismatch`/`lateOverlayDetected` below). `'skipped'` means the list item had no `<h3>` and so wasn't a real job card — it was never clicked, and every other field is null/false except `scrapedAt`, which is always set. `'failed'` means the click or read threw; `error` carries the message, `company`/`descriptionText` are null, and both suspicion flags are forced to `false`.
- **`title`** — falls back to a synthetic `<runTimestamp>-<paddedIndex>` string (e.g. `1721904000000-007`) when the real title couldn't be read, so it is only `null` for `'skipped'` entries.
- **`companyMismatch` / `lateOverlayDetected`** — the two staleness signals. Pass the result to the exported `isStaleResult(result)` rather than testing them by hand; it folds both into one predicate and is the same check the engine used to decide whether to retry. A result still flagged after the run means the retry didn't clear it — treat its `company`/`descriptionText` as possibly belonging to the previously-viewed job.
- **`sourceUrl` / `sourceHostname` / `scrapedAt`** — `sourceUrl` is the absolute URL of the individual job posting (each job has its own; it is not the search URL). It's scraped directly from the job list item's own link before the card is even clicked — LinkedIn's guest search re-renders the detail pane client-side on click, so `page.url()` never changes and can't be used for this — and then normalized: resolved against the search page URL and stripped of LinkedIn's per-session `refId`/`trackingId`/`position` query string, so the same posting produces the same URL on every run and is safe to dedupe or upsert on. Because it's captured before the click, it survives a later click/detail-pane failure. It is `null` whenever no usable URL could be read: `'skipped'` results, a `'failed'` result whose error preceded the identity read, a card with no link, or an href with no hostname — so **a `'success'` result can still carry a `null` `sourceUrl`**; don't assume otherwise. `sourceHostname` is `sourceUrl`'s hostname (`null` exactly when `sourceUrl` is); LinkedIn serves individual postings from country-specific subdomains, so it can differ across jobs in the same run. `scrapedAt` is always set, on every status.
- **`duplicateOfIdx`** — LinkedIn's guest pagination can re-serve an earlier page verbatim. Repeats are scraped in full and only marked: `null` on first (and only) occurrences, otherwise the index of the first job with the same `sourceJobId`. Filter on `duplicateOfIdx === null` if you want each posting once. It stays `null` whenever `sourceJobId` is `null`, since identity can't be established.
- **`companyUrl`** — the hiring company's LinkedIn page, read from the card's company link and normalized the same way `sourceUrl` is (resolved against the search URL, `?trk=` tracking stripped). Like `sourceUrl` it's captured before the click, so it survives a later failure. It's also the key the run's address cache uses — deliberately not the company's display name, which LinkedIn abbreviates in the list ("Slalom" for `slalom-consulting`) in ways that collide between unrelated companies.
- **`companyAddresses`** — office addresses from that company page, **with the address LinkedIn tags "Primary" at index 0**. `null` and `[]` mean different things: `[]` means the page was read and the company publishes no address, while `null` means no lookup happened or it failed (no `companyUrl`, a blocked page, a navigation error). **Expect roughly 70% of companies to return addresses** — the rest genuinely publish none on their guest page. That is normal, not a bug. A run where *nothing* comes back is a different signal; see the note on cookies below.
- **`location`** — the list card's location span, scraped verbatim with no parsing. Read at the same point as `sourceUrl`/`companyUrl`, so it survives a later click/detail-pane failure. `null` when the card carries no usable location span.
- **`postedAt`** — the list card's posting date, taken from the `datetime` attribute (e.g. `'2026-07-21'`) rather than the relative display text ("5 days ago"), which goes stale the moment it's stored. Read and captured the same way as `location`.
- **`tags`** — the *values* (not the labels) from the detail pane's job-criteria list: seniority level, employment type, job function, industries, in whatever order LinkedIn renders them. `null` and `[]` mean different things, the same way they do for `companyAddresses`: `[]` means the detail pane was read and the job genuinely lists no criteria, `null` means the read never happened or failed.

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

- `jobs:loading` — the unique job count changed during the scroll/click loading phase (in practice, grew). `count` is the number of distinct posting IDs currently in the list, not a delta; it fires several times per run, and not at all if loading never makes progress.
- `jobs:found` — loading finished; `total` is the number of jobs about to be scraped and is final for the run.
- `job:start` — about to scrape the job at `index` (0-based) out of `total`.
- `job:done` — a job finished scraping and the result looks trustworthy. This is also the event a `status: 'failed'` job emits — check `result.status`, don't assume done means scraped.
- `job:stale` — a job finished scraping but `isStaleResult(result)` is true: the scrape succeeded, yet the detail-pane company disagreed with the list, or a sign-in overlay was still visible when the data was read. Emitted *instead of* `job:done` for that job, never both.

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
