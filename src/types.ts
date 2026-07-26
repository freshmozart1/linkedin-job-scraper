export type JobStatus = 'success' | 'skipped' | 'failed';

/**
 * One office address published in the "Locations" section of a company's
 * LinkedIn page, split the way LinkedIn itself renders it.
 *
 * LinkedIn prints each address as an optional street block followed by a
 * single locality line of the form `<city>, <region> <postal>, <CC>`. The
 * region and the postal code are not separated in that line, so they stay
 * joined here in `postalCode` (e.g. `'Hessen 60313'`) rather than being
 * guessed apart. Every field is nullable because LinkedIn omits parts freely:
 * `Wien, AT` carries no street and no postal code at all.
 */
export interface CompanyAddress {
  /** Street line(s) as printed, joined with `', '` when LinkedIn shows two. Null when the address has no street block. */
  streetAddress: string | null;
  city: string | null;
  /** Region and postal code as LinkedIn renders them together, e.g. `'Hessen 60313'` or `'WA 98104'`. */
  postalCode: string | null;
  /** ISO-3166 alpha-2 country code, uppercased, e.g. `'DE'`. */
  countryCode: string | null;
}

/** One `<li>` from a company page's Locations section, as read off the DOM before parsing. */
export interface RawCompanyLocation {
  /** Whether LinkedIn tagged this location as the company's primary one. */
  isPrimary: boolean;
  /** The `<p>` texts in DOM order; the last one is always the locality line. */
  lines: string[];
}

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
  /**
   * Absolute URL of the hiring company's LinkedIn page, scraped from the list
   * item's company link and normalized the same way `sourceUrl` is: resolved
   * against the search page URL and stripped of the `?trk=` tracking query, so
   * the same company yields the same URL on every run.
   *
   * This is also the key the run's address cache is built on, which is why it
   * isn't the company's display name — LinkedIn shows short, ambiguous labels
   * in the list ("Slalom" for `slalom-consulting`) that can collide between
   * unrelated companies. Null when the card carries no usable company link.
   */
  companyUrl: string | null;
  /**
   * Office addresses published on the company's LinkedIn page, with the
   * address LinkedIn tags "Primary" at index 0.
   *
   * The empty array and null mean different things and the distinction is the
   * only way to tell them apart downstream: `[]` means the company page was
   * read successfully and publishes no address, whereas `null` means no
   * lookup happened or it failed (no `companyUrl`, a blocked page, a
   * navigation error). Roughly 30% of companies legitimately publish none.
   */
  companyAddresses: CompanyAddress[] | null;
  /**
   * The list card's location text (`span.job-search-card__location`), scraped
   * verbatim with no parsing. Read at the same point as `sourceUrl`, so it
   * survives a later click/detail-pane failure. Null when the card carries no
   * usable location span.
   */
  location: string | null;
  /**
   * The list card's posting date, read from `time.job-search-card__listdate`'s
   * `datetime` attribute (e.g. `'2026-07-21'`) rather than the relative
   * display text ("5 days ago"), which goes stale as soon as it's stored.
   * Read at the same point as `sourceUrl`, so it survives a later
   * click/detail-pane failure. Null when the card carries no usable element.
   */
  postedAt: string | null;
  /**
   * The values (not labels) from the detail pane's job-criteria list —
   * seniority level, employment type, job function, industries, in whatever
   * order LinkedIn renders them — as plain strings.
   *
   * `[]` and `null` are distinct, the same way they are for
   * `companyAddresses`: `[]` means the detail pane was read and the job
   * genuinely lists no criteria, whereas `null` means the read never
   * happened or failed.
   */
  tags: string[] | null;
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
  /** Timings and limits for the company-page address lookup; see `createCompanyLookup`. */
  companyLookup?: {
    navigationTimeoutMs?: number;
    /**
     * Extra attempts whenever an attempt yields no addresses: a company page that loads with no
     * Locations section (LinkedIn serves it intermittently), an `/authwall` bounce, or a
     * navigation error. `0` disables retrying all three, not just the empty-section case.
     */
    emptyRetries?: number;
    /** Pause after a lookup that actually hit the network; cache hits are not delayed. */
    delayBetweenLookupsMs?: number;
    /** Optional cap on addresses kept per company (some publish 100+). The list is primary-first, so any cap of 1 or more keeps the primary. */
    maxAddressesPerCompany?: number;
  };
}

export interface RunScrapeOptions {
  onProgress?: (event: ScrapeProgressEvent) => void;
  searchParams: SearchParams;
  scraperOptions?: ScraperOptions;
}

export type RunScraper = (options: RunScrapeOptions) => Promise<ScrapeOutcome>;
