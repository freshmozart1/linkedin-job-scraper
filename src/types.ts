export type JobStatus = 'success' | 'skipped' | 'failed';

/** One scraped job card, as produced by the scraper (camelCase). */
export interface JobResult {
  index: number;
  title: string | null;
  company: string | null;
  descriptionText: string | null;
  status: JobStatus;
  error: string | null;
  companyMismatch: boolean;
  /** Whether a LinkedIn sign-in overlay was detected reappearing late, around when this job's data was read. */
  lateOverlayDetected: boolean;
  /**
   * LinkedIn's numeric posting ID, read from the list item's `data-entity-urn`
   * and falling back to the trailing ID in `sourceUrl` when that attribute is
   * missing; used to detect duplicate/repeated list pages.
   */
  sourceJobId: string | null;
  /**
   * Absolute URL of this individual job posting (not the search page — each
   * job has its own), scraped from the list item's own link before the card is
   * even clicked, then normalized: resolved against the search page URL and
   * stripped of LinkedIn's per-session tracking query string, so the same
   * posting yields the same URL on every run and is safe to dedupe or upsert
   * on.
   *
   * Null whenever no usable URL could be read: a `'skipped'` result, a
   * `'failed'` result whose error preceded the identity read, a card with no
   * link, or an href carrying no hostname (e.g. `javascript:void(0)`). A
   * `'success'` result can therefore still carry a null `sourceUrl`.
   */
  sourceUrl: string | null;
  /**
   * Hostname of `sourceUrl`, e.g. `de.linkedin.com`. LinkedIn serves
   * individual job postings from country-specific subdomains, so this can
   * differ across jobs within the same run. Null exactly when `sourceUrl` is
   * null. Re-derivable from a stored `sourceUrl` via the exported
   * `hostnameOf`.
   */
  sourceHostname: string | null;
  /** ISO-8601 timestamp (`new Date().toISOString()`) marking when this job's result was finalized — always set, even for `'skipped'`/`'failed'` results. */
  scrapedAt: string;
  /** Index of the earlier job in this run with the same posting ID; null when not a duplicate. */
  duplicateOfIdx: number | null;
}

export interface JobsLoadingEvent {
  type: 'jobs:loading';
  count: number;
}
export interface JobsFoundEvent {
  type: 'jobs:found';
  total: number;
}
export interface JobStartEvent {
  type: 'job:start';
  index: number;
  total: number;
}
export interface JobDoneEvent {
  type: 'job:done';
  result: JobResult;
}
/**
 * Emitted instead of `job:done` when the scrape technically succeeded but the
 * result is suspect: the detail-pane company disagreed with the list, or a
 * sign-in overlay was still visible right when this job's data was read. See
 * `isStaleResult`. Never emitted for a `status: 'failed'` result — a failed
 * scrape always emits `job:done`.
 */
export interface JobStaleEvent {
  type: 'job:stale';
  result: JobResult;
}
/** Progress callback payloads emitted while a scrape is running. */
export type ScrapeProgressEvent =
  | JobsLoadingEvent
  | JobsFoundEvent
  | JobStartEvent
  | JobDoneEvent
  | JobStaleEvent;

export interface ScrapeOutcome {
  results: JobResult[];
  url: string;
}

export interface CompanyMismatchCheck {
  listCompany: string | null;
  detailCompany: string | null;
}

/**
 * Every field the LinkedIn guest job-search URL supports through this
 * package. Only `keywords` is required — nothing else is defaulted or
 * hardcoded; omitted fields are simply not sent as query params.
 */
export interface SearchParams {
  keywords: string;
  location?: string;
  geoId?: string;
  datePosted?: 'day' | 'week' | 'month';
  experienceLevels?: (
    | 'internship'
    | 'entry'
    | 'associate'
    | 'mid-senior'
    | 'director'
    | 'executive'
  )[];
  jobTypes?: ('full-time' | 'part-time' | 'contract' | 'temporary' | 'volunteer' | 'internship' | 'other')[];
  workplaceTypes?: ('on-site' | 'remote' | 'hybrid')[];
  distanceMiles?: number;
  sortBy?: 'relevance' | 'date';
  /** Escape hatch for any LinkedIn query param not modeled above; applied last, verbatim. */
  extraParams?: Record<string, string>;
}

/**
 * Every currently-tunable engine constant, all optional and defaulted to
 * this package's own historically-working values — nothing here is fixed
 * inside the engine itself.
 */
export interface ScraperOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  maxScrollAttempts?: number;
  stableScrollsToStop?: number;
  maxSeeMoreClicks?: number;
  stableClicksToStop?: number;
  delayBetweenJobsMs?: number;
  clickRetryAttempts?: number;
  overlayClear?: { timeoutMs?: number; pollIntervalMs?: number; requiredConsecutiveClear?: number };
}

export interface RunScrapeOptions {
  onProgress?: (event: ScrapeProgressEvent) => void;
  searchParams: SearchParams;
  scraperOptions?: ScraperOptions;
}

export type RunScraper = (options: RunScrapeOptions) => Promise<ScrapeOutcome>;
