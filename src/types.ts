export type JobStatus = 'success' | 'failed';

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

/**
 * Fields common to every scraped job card, regardless of whether the scrape
 * succeeded or failed partway through.
 */
interface JobResultBase {
    index: number;
    /**
     * Whether the detail-pane company disagreed with the list-pane company for
     * this job — the primary signal `isStaleResult` uses to catch a detail pane
     * that didn't re-render after a click. It cannot catch a pane left over
     * from an earlier posting at the *same* company: two back-to-back postings
     * from the same employer read as a match here even if the pane never
     * updated, so `descriptionText`/`tags` can silently carry the earlier
     * job's values in that case. Always `false` on a `'failed'` result.
     */
    companyMismatch: boolean;
    /** Whether a LinkedIn sign-in overlay was detected reappearing late, around when this job's data was read. Always `false` on a `'failed'` result. */
    lateOverlayDetected: boolean;
    /** ISO-8601 timestamp (`new Date().toISOString()`) marking when this job's result was finalized — always set, even for `'failed'` results. */
    scrapedAt: string;
    /** Index of the earlier job in this run with the same posting ID; null when not a duplicate. */
    duplicateOfIdx: number | null;
}

/** A job card that was fully scraped. */
export interface SuccessfulJobResult extends JobResultBase {
    status: 'success';
    title: string;
    company: string;
    /** Detail-pane job description text. Subject to the same-company staleness blind spot documented on `companyMismatch`. */
    descriptionText: string;
    /**
     * LinkedIn's numeric posting ID, read from the list item's `data-entity-urn`
     * and falling back to the trailing ID in `sourceUrl` when that attribute is
     * missing; used to detect duplicate/repeated list pages. `scrapeJob` throws
     * if neither source yields an ID.
     */
    sourceJobId: string;
    /**
     * Absolute URL of this individual job posting (not the search page — each
     * job has its own), scraped from the list item's own link before the card is
     * even clicked, then normalized: resolved against the search page URL and
     * stripped of LinkedIn's per-session tracking query string, so the same
     * posting yields the same URL on every run and is safe to dedupe or upsert
     * on.
     *
     * `scrapeJob` throws if the card has no link or the href carries no
     * hostname (e.g. `javascript:void(0)`), rather than returning a result
     * with a missing `sourceUrl`.
     */
    sourceUrl: string;
    /**
     * Hostname of `sourceUrl`, e.g. `de.linkedin.com`. LinkedIn serves
     * individual job postings from country-specific subdomains, so this can
     * differ across jobs within the same run. Re-derivable from a stored
     * `sourceUrl` via the exported `hostnameOf`.
     */
    sourceHostname: string;
    /**
     * Absolute URL of the hiring company's LinkedIn page, scraped from the list
     * item's company link and normalized the same way `sourceUrl` is: resolved
     * against the search page URL and stripped of the `?trk=` tracking query, so
     * the same company yields the same URL on every run.
     *
     * This is also the key the run's address cache is built on, which is why it
     * isn't the company's display name — LinkedIn shows short, ambiguous labels
     * in the list ("Slalom" for `slalom-consulting`) that can collide between
     * unrelated companies. `scrapeJob` throws if the card carries no usable
     * company link.
     */
    companyUrl: string;
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
     * survives a later click/detail-pane failure. `scrapeJob` throws if the
     * card carries no usable location span.
     */
    location: string;
    /**
     * The list card's posting date, read from `time.job-search-card__listdate`'s
     * `datetime` attribute (e.g. `'2026-07-21'`) rather than the relative
     * display text ("5 days ago"), which goes stale as soon as it's stored.
     * Read at the same point as `sourceUrl`, so it survives a later
     * click/detail-pane failure. `scrapeJob` throws if the card carries no
     * usable element.
     */
    postedAt: string;
    /**
     * The values (not labels) from the detail pane's job-criteria list —
     * seniority level, employment type, job function, industries, in whatever
     * order LinkedIn renders them — as plain strings.
     *
     * `[]` means the detail pane was read and the job genuinely lists no
     * criteria; `scrapeJob` throws if the read itself fails. Subject to the
     * same-company staleness blind spot documented on `companyMismatch`.
     */
    tags: string[];
}

/**
 * A job card whose scrape threw before finishing. Every field below `error`
 * holds whatever was captured before the failure — `null` if the failure
 * happened before that particular read. `company`/`descriptionText`/
 * `companyAddresses`/`tags` are always `null`: they're only ever read after
 * every field above them, so a failure can never leave them partially set.
 */
export interface FailedJobResult extends JobResultBase {
    status: 'failed';
    /** The thrown error's message. */
    error: string;
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

/** One scraped job card, as produced by the scraper (camelCase). */
export type JobResult = SuccessfulJobResult | FailedJobResult;

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
 * package. Only `keyword` is required — nothing else is defaulted or
 * hardcoded; omitted fields are simply not sent as query params.
 */
export interface SearchParams {
    keyword: string;
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
    jobTypes?: (
        | 'full-time'
        | 'part-time'
        | 'contract'
        | 'temporary'
        | 'volunteer'
        | 'internship'
        | 'other'
    )[];
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
    overlayClear?: {
        timeoutMs?: number;
        pollIntervalMs?: number;
        requiredConsecutiveClear?: number;
    };
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
