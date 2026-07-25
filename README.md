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

## Progress events

`onProgress` is called with a `ScrapeProgressEvent` at each of these points:

- `jobs:loading` — the unique job count grew during the scroll/click loading phase (`{ count }`).
- `jobs:found` — loading finished; this is the total number of jobs about to be scraped (`{ total }`).
- `job:start` — about to scrape the job at `index` out of `total` (`{ index, total }`).
- `job:done` — a job finished scraping and the result looks trustworthy (`{ result }`).
- `job:stale` — a job finished scraping but `isStaleResult(result)` is true: the scrape succeeded, but the detail-pane company disagreed with the list, or a sign-in overlay was still visible when the data was read. Fired instead of `job:done` for that job. A stale job gets one retry pass; the retry re-emits `job:done` if it comes back clean, or `job:stale` again if it doesn't.

`isStaleResult` is exported so callers can apply the same classification to any `JobResult` after the fact (e.g. when inspecting `outcome.results`) without re-deriving the condition themselves.

## Notes

- Guest/unauthenticated view only — no login, no credentials.
- LinkedIn's markup and anti-bot gating can change or vary by session; this scrapes an unofficial, moving surface.
- `runScrape` launches and closes its own Chromium browser per call.
