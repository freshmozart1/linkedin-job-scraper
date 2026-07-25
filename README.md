# linkedin-job-scraper

Playwright-driven scraper for LinkedIn's public/guest job search results (no login required). Loads all jobs on a search via infinite scroll and "See more jobs" pagination, then scrapes title/company/description for every job card, with duplicate/stale-retry detection built in.

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
  sourceUrl: string | null;         // the job's canonical URL, scraped from the list item's link
  sourceHostname: string | null;    // sourceUrl's hostname, e.g. de.linkedin.com (varies per job)
  scrapedAt: string;                // ISO-8601 timestamp, new Date().toISOString()
  duplicateOfIdx: number | null;    // index of the first job with this posting ID, else null
}
```

Field notes worth knowing before you consume this:

- **`status`** — `'success'` means the card was clicked and the detail pane was read (that does *not* by itself mean the data is trustworthy; see `companyMismatch`/`lateOverlayDetected` below). `'skipped'` means the list item had no `<h3>` and so wasn't a real job card — it was never clicked, and every other field is null/false except `scrapedAt`, which is always set. `'failed'` means the click or read threw; `error` carries the message, `company`/`descriptionText` are null, and both suspicion flags are forced to `false`.
- **`title`** — falls back to a synthetic `<runTimestamp>-<paddedIndex>` string (e.g. `1721904000000-007`) when the real title couldn't be read, so it is only `null` for `'skipped'` entries.
- **`companyMismatch` / `lateOverlayDetected`** — the two staleness signals. Pass the result to the exported `isStaleResult(result)` rather than testing them by hand; it folds both into one predicate and is the same check the engine used to decide whether to retry. A result still flagged after the run means the retry didn't clear it — treat its `company`/`descriptionText` as possibly belonging to the previously-viewed job.
- **`sourceUrl` / `sourceHostname` / `scrapedAt`** — `sourceUrl` is scraped directly from the job list item's own link, before the card is even clicked (LinkedIn's guest search re-renders the detail pane client-side on click, so `page.url()` never changes and can't be used for this). Because of that, both survive a later click/detail-pane failure — they're `null` only for `'skipped'` results or a `'failed'` result whose error happened before the job's identity could be read. `sourceHostname` is `sourceUrl`'s hostname; LinkedIn assigns individual postings to country-specific subdomains, so this can differ across jobs in the same run. `scrapedAt` is always set, even then.
- **`duplicateOfIdx`** — LinkedIn's guest pagination can re-serve an earlier page verbatim. Repeats are scraped in full and only marked: `null` on first (and only) occurrences, otherwise the index of the first job with the same `sourceJobId`. Filter on `duplicateOfIdx === null` if you want each posting once. It stays `null` whenever `sourceJobId` is `null`, since identity can't be established.

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

## Notes

- Guest/unauthenticated view only — no login, no credentials.
- LinkedIn's markup and anti-bot gating can change or vary by session; this scrapes an unofficial, moving surface.
- `runScrape` launches and closes its own Chromium browser per call.
