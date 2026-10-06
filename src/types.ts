export type JobStatus = 'success' | 'failed' | 'skipped';

/** Machine-readable classification for failures callers may want to handle specially. */
export type FailedJobReason = 'detail-pane-identity-unverified';

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
 * The list-level identity of a job card, read off it by `readJobListIdentity`
 * before the card is ever clicked. Passed to `ScraperOptions.shouldScrapeJob`
 * so a consumer can decide whether a job is worth the full detail scrape
 * using only what's visible in the search results list — title, company,
 * location, posted date — without paying for the click-through.
 */
export interface JobCardIdentity {
    title: string;
    sourceUrl: string;
    sourceHostname: string;
    sourceJobId: string;
    companyUrl: string;
    location: string;
    postedAt: string;
}

/**
 * A pre-click filter over a job card's list-level identity; see
 * `ScraperOptions.shouldScrapeJob`. Shared type so `ScraperOptions`,
 * `ScrapeContext`, and `ScrapeJobOptions` all reference the same signature
 * instead of repeating the structural literal.
 *
 * Must be synchronous. `!shouldScrapeJob(identity)` is checked directly
 * against the return value — an `async` function assigned here typechecks
 * as an error (`Promise<boolean>` isn't assignable to `boolean`), but a
 * consumer that bypasses the type system (`as any`, a plain-JS caller of
 * the compiled output) and passes one anyway will see the promise treated
 * as always-truthy: the skip branch never fires, and the job is scraped as
 * if the predicate had returned `true`. Resolve any async work before
 * returning a plain `boolean`.
 */
export type ShouldScrapeJob = (identity: JobCardIdentity) => boolean;

/**
 * Fields common to every scraped job card, regardless of whether the scrape
 * succeeded or failed partway through.
 */
interface JobResultBase {
    index: number;
    /**
     * Whether the detail-pane company disagreed with the list-pane company for
     * this job — one of the signals `isStaleResult` uses to catch a detail pane
     * that didn't re-render after a click. It cannot catch a pane left over
     * from an earlier posting at the *same* company: two back-to-back postings
     * from the same employer read as a match here even if the pane never
     * updated. `sourceJobIdMismatch` closes that gap. Always `false` on a
     * `'failed'` result.
     */
    companyMismatch: boolean;
    /**
     * Whether the detail pane's own title-link href (see
     * `DETAIL_TITLE_LINK_SELECTOR`) carries a different job ID than this
     * job's `sourceJobId` — the signal `isStaleResult` uses to catch a
     * detail pane left over from an earlier posting at the *same* company,
     * which `companyMismatch` alone cannot see. `false` when the detail
     * title link couldn't be read at all, not just when the IDs agree.
     * Always `false` on a `'failed'` result.
     */
    sourceJobIdMismatch: boolean;
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
    /** Detail-pane job description text. `sourceJobIdMismatch` (alongside `companyMismatch`) flags when this may actually belong to an earlier posting. */
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
     * missing or unsuccessful HTTP response, navigation error). Roughly 30%
     * of companies legitimately publish none.
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
     * The list card's posting date, read from the posting-date `<time>`
     * element's `datetime` attribute (e.g. `'2026-07-21'`) rather than the
     * relative display text ("5 days ago"), which goes stale as soon as
     * it's stored. LinkedIn renders this element under either
     * `job-search-card__listdate` or, for very recently posted jobs,
     * `job-search-card__listdate--new` (see `LIST_POSTED_AT_SELECTOR`).
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
     * criteria; `scrapeJob` throws if the read itself fails.
     * `sourceJobIdMismatch` (alongside `companyMismatch`) flags when this
     * may actually belong to an earlier posting.
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
    /**
     * Present for a failure with a stable, machine-readable recovery policy.
     * Omitted for ordinary Playwright, markup, budget, and abort failures.
     */
    failureReason?: FailedJobReason;
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

/**
 * A job card whose full detail scrape never ran because `shouldScrapeJob`
 * returned `false` for it. Every field inherited from `JobCardIdentity`
 * below is exactly what `readJobListIdentity` read off the card before the
 * callback was consulted — nothing from the detail pane or the company
 * lookup was ever read, since the card was never clicked.
 * `company`/`descriptionText`/`companyAddresses`/`tags` are always `null`
 * for the same reason.
 */
export interface SkippedJobResult extends JobResultBase, JobCardIdentity {
    status: 'skipped';
    company: null;
    descriptionText: null;
    companyAddresses: null;
    tags: null;
}

/** One scraped job card, as produced by the scraper (camelCase). */
export type JobResult = SuccessfulJobResult | FailedJobResult | SkippedJobResult;

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
    /**
     * Everything the scrape observed about this job (GitHub issue #29).
     * Present on `job:done` as well as on `job:stale`, and that is the
     * point: the healthy jobs are the denominator, so a consumer aggregating
     * these can answer "how often does this condition go *with* a clean
     * scrape" rather than only counting the suspect ones. Absent when
     * `ScraperOptions.staleDiagnostics.enabled` is `false`. Skipped jobs carry
     * a minimal record so positional analysis retains every list index.
     */
    diagnostics?: StaleDiagnostics;
}
/**
 * Emitted instead of `job:done` when the scrape technically succeeded but the
 * result is suspect: the detail-pane company disagreed with the list, the
 * detail pane's own job ID disagreed with the clicked job's, or a sign-in
 * overlay was still visible right when this job's data was read. See
 * `isStaleResult`. Never emitted for a `status: 'failed'` result — a failed
 * scrape always emits `job:done`.
 */
export interface JobStaleEvent {
    type: 'job:stale';
    result: JobResult;
    /** See `JobDoneEvent.diagnostics`; on this event it always describes a job at least one flag fired for. */
    diagnostics?: StaleDiagnostics;
}
/**
 * Everything `readOverlayDiagnostics` can see about a blocking overlay, read
 * in a single `page.evaluate`.
 *
 * This exists because GitHub issue #27 could not be diagnosed from the
 * outside: an overlay sat over the job list and swallowed every click, but
 * the run happened in an untouched automated browser, so nobody ever read
 * what the overlay actually *said*. "Probably a sign-in wall" stayed an
 * inference. These three fields are what turns that inference into a fact
 * on the next occurrence — without a human watching the run.
 */
export interface OverlayDiagnostics {
    /**
     * The overlay's own text with all whitespace collapsed to single spaces
     * and the result length-capped, so one runaway node can't bloat a
     * progress event or an error message. Read via `textContent`, not
     * `innerText`: an overlay whose base classes still say `invisible`
     * reports an empty `innerText` even while it is intercepting clicks.
     */
    text: string;
    /**
     * The overlay element's full class list in DOM order. The whole point of
     * issue #27 was that the base classes (`opacity-0 invisible
     * pointer-events-none`) are overridden at runtime by a `--visible`
     * modifier, so the class list is the direct evidence of which overlay
     * variant was on screen.
     */
    classes: string[];
    /**
     * The accessible name of each control matched by
     * `OVERLAY_BUTTON_SELECTOR` inside the overlay, in DOM order:
     * a non-empty `aria-label` when present, otherwise the trimmed text.
     * `''` for the classic icon-only close control, which is precisely the
     * case the old name-matched click could never reach.
     */
    buttonNames: string[];
}
/**
 * Emitted once per `clearBlockingOverlays` call that had to escalate past
 * the button-click and `Escape` tiers — i.e. the overlay had to be forcibly
 * neutralized, or it was *still* visible when the call returned.
 *
 * Deliberately not emitted on the ordinary path where a click or `Escape`
 * dismissed the overlay: that is normal LinkedIn behavior on every guest
 * page load and would drown the signal. Consumers that only handle
 * `job:done` are unaffected — this is an additional union member, not a
 * change to an existing one.
 */
export interface OverlayUndismissedEvent {
    type: 'overlay:undismissed';
    /** Whether the `--visible` modifier was stripped to force the overlay out of the way. `false` means it is still blocking. */
    neutralized: boolean;
    /** What the overlay was; `null` only when the diagnostics read itself failed. */
    diagnostics: OverlayDiagnostics | null;
}
/** Progress callback payloads emitted while a scrape is running. */
export type ScrapeProgressEvent =
    | JobsLoadingEvent
    | JobsFoundEvent
    | JobStartEvent
    | JobDoneEvent
    | JobStaleEvent
    | OverlayUndismissedEvent;

/**
 * What `clearBlockingOverlays` managed to do about the overlays it found.
 *
 * Replaces the single `boolean` it used to return, which conflated "an
 * overlay was dismissed" with "the page is clickable now" and left callers
 * re-querying the page themselves to tell the two apart (GitHub issue #27).
 */
export interface OverlayClearResult {
    /** Whether this clear observed an overlay at least once. */
    observed: boolean;
    /** An overlay was found and a button click or `Escape` made it go away. */
    dismissed: boolean;
    /** Nothing dismissed an overlay, so its `--visible` modifier was stripped and `pointer-events: none` forced on it. */
    neutralized: boolean;
    /**
     * An overlay is *still* visible as this returns. This — not
     * `!dismissed` — is the "the next click cannot land" answer, and it is
     * why callers no longer need their own follow-up `findVisibleOverlay`.
     */
    stillBlocking: boolean;
    /** The latest successful read of an observed overlay; null when none was available. */
    diagnostics: OverlayDiagnostics | null;
    /** Whether reading a visible overlay's diagnostics threw. */
    diagnosticsReadFailed: boolean;
}

/**
 * One job's wall-clock deadline, created per job by `createJobBudget` and
 * threaded through every Playwright wait below `scrapeJob`.
 *
 * Clamping each individual wait — rather than racing the job against a timer
 * — is what makes the budget bound *real* elapsed time without leaving
 * orphaned browser work running behind a promise that already resolved. The
 * same object also carries the run's abort signal, so an abort lands inside a
 * slow job within seconds instead of only between jobs.
 */
export interface JobBudget {
    /** Absolute epoch-ms this job must be finished by; `Infinity` when the budget is disabled. */
    deadline: number;
    /**
     * Clamps one local Playwright timeout to whatever is left of the budget:
     * never above `cap`, and never `0` — Playwright reads `0` as "no
     * timeout", which is the exact opposite of what a spent budget means. A
     * spent or aborted budget returns `1`, collapsing the wait immediately.
     *
     * Never throws, and that is load-bearing: `trim` swallows every rejection
     * from its reads, so a clamp that threw would be laundered into a
     * misleading `No job title found for this list item`. Stopping the job is
     * `check`'s job instead.
     */
    boundedTimeout(cap: number): number;
    /**
     * Throws at a step boundary once the job may not continue. Whatever
     * stopped the whole *run* is reported first — `Scrape aborted` when the
     * caller aborted, or `Run exceeded its <n>ms time budget` when
     * `ScraperOptions.maxRunDurationMs` ran out — since a run that is already
     * over cannot be rescued by finishing the job in front of it, and since a
     * caller who asked to stop should read that back rather than a budget
     * message that expired in the same moment. Failing those, this job's own
     * deadline gives `Job exceeded per-job time budget of <n>ms`.
     * `scrapeJob`'s existing `catch` turns any of them into a
     * `status: 'failed'` result carrying whatever identity was captured
     * before the failure.
     */
    check(): void;
    /** Milliseconds left; `0` once spent or aborted, `Infinity` when the budget is disabled. */
    remaining(): number;
}

/**
 * The whole run's optional wall-clock budget (`ScraperOptions.maxRunDurationMs`),
 * expressed as an `AbortSignal` rather than as a new parameter on every phase.
 *
 * Every checkpoint that already stops on `signal?.aborted` — `scrollLoadPhase`,
 * `clickLoadPhase`, `pollForJobListProgress`, and the first-pass/retry loops —
 * then honours the run budget for free, with no change to their contracts,
 * which stay about *stopping early* rather than about any particular error
 * type. `runScrape` remains the only place that tells a caller abort and an
 * expired budget apart.
 */
export interface RunTimeBudget {
    /** The caller's signal composed with the budget timer, or just the caller's own when no budget was asked for. */
    signal?: AbortSignal;
    /**
     * The message a run — or a job caught in flight — should report when the
     * *timer* is what stopped it, and `null` when it is not: `null` for a run
     * with no budget, and `null` for a plain caller abort, which `runScrape`
     * still reports as `ScrapeAbortedError`.
     *
     * One nullable string rather than a boolean paired with a message,
     * because both callers need both halves and would otherwise re-derive the
     * wording independently. It also encodes the caller-abort-wins ordering
     * exactly once, here, where both signals are in scope: a caller who asked
     * to stop reads that back even if the timer expired in the same moment.
     */
    exceededReason(): string | null;
}

export interface ScrapeOutcome {
    results: JobResult[];
    url: string;
    /**
     * Set only when the run stopped short of scraping every job it found
     * because `ScraperOptions.maxRunDurationMs` ran out. Absent on a run that
     * finished, so this is additive for every existing consumer.
     *
     * A budget the caller asked for is an expected outcome, not a failure, so
     * `runScrape` *resolves* with the results gathered so far — unlike an
     * abort, which keeps rejecting with `ScrapeAbortedError`.
     */
    stoppedEarly?: 'run-time-budget';
    /**
     * The run's stale diagnostics. Headline rates cover successful first-pass
     * jobs; retry attempts remain in the raw records and retry counters
     * (GitHub issue #29). Absent when
     * `ScraperOptions.staleDiagnostics.enabled` is `false`; present — with a
     * `staleRate` of `0` and no records — on an enabled run that scraped
     * nothing, so "diagnostics were on and found nothing" stays
     * distinguishable from "diagnostics were off".
     *
     * Also attached to the early return a spent `maxRunDurationMs` produces:
     * a run that stopped short still observed everything it got through, and
     * that partial evidence is exactly what a diagnostic run wants back.
     */
    staleReport?: StaleReport;
}

export interface CompanyMismatchCheck {
    listCompany: string | null;
    detailCompany: string | null;
}

export interface SourceJobIdMismatchCheck {
    /** The clicked job's own posting ID, from the list card. */
    sourceJobId: string | null;
    /** The detail pane's title-link `href` (see `DETAIL_TITLE_LINK_SELECTOR`), unread. */
    detailTitleHref: string | null;
    /** The page's current URL, used to resolve a relative `detailTitleHref`. */
    baseUrl: string;
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
    /** Defensive bound on incremental-scroll passes. */
    maxScrollAttempts?: number;
    /** Consecutive reads with neither unique-job nor raw-list progress required before stopping. */
    stableScrollsToStop?: number;
    /** Defensive bound on "See more jobs" clicks. */
    maxSeeMoreClicks?: number;
    /** Consecutive clicks with neither unique-job nor raw-list progress required before stopping. */
    stableClicksToStop?: number;
    /**
     * Caps how many of the loaded jobs are actually *scraped*; `undefined`
     * (the default) scrapes every distinct posting the search finds. Applied
     * after duplicate posting IDs are collapsed in first-occurrence order.
     * The load/discovery
     * phase (scroll + "See more") is unaffected and reaches its own end,
     * stability, abort, or safety-bound condition first. See
     * `clampTotalJobs`, applied once in `runScrape`. `0` or a negative value
     * scrapes none rather than throwing.
     */
    maxJobs?: number;
    /**
     * Called with a job card's list-level identity (see `JobCardIdentity`),
     * right after `readJobListIdentity` succeeds and before the card is
     * clicked. Returning `false` skips that job's full detail scrape
     * entirely — no click, no company lookup — and records a
     * `status: 'skipped'` result at that index instead. Omitted, every job
     * is scraped as before.
     *
     * Normally called once per distinct posting, but a job whose first pass came
     * back `'success'` yet stale (see `isStaleResult`) gets exactly one
     * retry via `retryStaleJobs`, which re-reads the list card and consults
     * this callback again — so a stateful predicate can see the same
     * `sourceJobId` twice with different answers across the two passes. A
     * retry that flips to `false` replaces the earlier `'success'` result
     * with an empty `'skipped'` one at that index.
     */
    shouldScrapeJob?: ShouldScrapeJob;
    /**
     * Wall-clock budget for one job's entire scrape, in milliseconds. Default
     * `45000`; `0` or a negative value disables it, following Playwright's own
     * "0 means no timeout" convention.
     *
     * Nothing else bounds a single job. Every wait in the per-job path has its
     * own local timeout, but they stack to over 100 seconds, and a run scrapes
     * every discovered job in sequence — so one systematically blocked click
     * could make a 30-job run spend the better part of an hour producing
     * nothing (GitHub issue #28). A job that blows this budget is abandoned and
     * recorded as `status: 'failed'` with
     * `error: 'Job exceeded per-job time budget of <n>ms'`, carrying whatever
     * identity was read off the list card before the budget ran out; it emits
     * the usual `job:done` and the run moves on to the next job. It is not
     * retried — a job that blew its budget is usually blocked by something
     * run-wide (an overlay, a rate limit), so an immediate retry mostly
     * doubles the cost.
     *
     * Enforced by clamping every individual Playwright wait below `scrapeJob`
     * to what is left of the budget, so it bounds real elapsed time rather
     * than only being checked between steps.
     */
    perJobTimeoutMs?: number;
    /**
     * Optional wall-clock budget for the whole run, in milliseconds. No
     * default: omitted, a run takes as long as its jobs take.
     *
     * When it runs out the run stops at the next checkpoint — the same ones an
     * abort stops at — and `runScrape` *resolves* with the results gathered so
     * far plus `ScrapeOutcome.stoppedEarly: 'run-time-budget'`. A caller
     * `signal` abort always wins over the budget when both are true, and still
     * rejects with `ScrapeAbortedError`.
     */
    maxRunDurationMs?: number;
    delayBetweenJobsMs?: number;
    clickRetryAttempts?: number;
    overlayClear?: {
        timeoutMs?: number;
        pollIntervalMs?: number;
        requiredConsecutiveClear?: number;
        /**
         * How many rounds of "click the best control, then press `Escape`"
         * may fail against a still-visible overlay before it is neutralized
         * outright. Default `2`. Raising it trades a longer stall for more
         * chances at a genuine dismissal; `0` neutralizes on the first
         * round without ever clicking.
         */
        maxDismissAttempts?: number;
        /**
         * Whether the last-resort DOM mutation is allowed at all: stripping
         * the overlay's `--visible` modifier (which restores its own base
         * `opacity-0 invisible pointer-events-none` classes) and forcing
         * inline `pointer-events: none`. Default `true`, because the
         * alternative observed in GitHub issue #27 was every subsequent job
         * click failing against an overlay nothing could close. Set `false`
         * to keep the page untouched and accept `stillBlocking` instead.
         */
        neutralizeStuckOverlay?: boolean;
    };
    /** Timings and limits for the company-page address lookup; see `createCompanyLookup`. */
    companyLookup?: {
        navigationTimeoutMs?: number;
        /**
         * Extra attempts whenever an attempt yields no addresses: a company page that loads with no
         * Locations section (LinkedIn serves it intermittently), an `/authwall` bounce,
         * an unsuccessful or missing HTTP response, or a navigation error.
         * `0` disables retrying all these cases, not just the empty-section case.
         */
        emptyRetries?: number;
        /** Pause after a lookup that actually hit the network; cache hits are not delayed. */
        delayBetweenLookupsMs?: number;
        /** Optional cap on addresses kept per company (some publish 100+). The list is primary-first, so any cap of 1 or more keeps the primary. */
        maxAddressesPerCompany?: number;
    };
    /**
     * Switches for the per-job stale diagnostics (GitHub issue #29): what
     * `ScrapeOutcome.staleReport` and the two job events' `diagnostics` are
     * built from. Omitted, collection is **on** and the DOM snapshot is off
     * — see `StaleDiagnosticsOptions` for why that split is the default.
     */
    staleDiagnostics?: StaleDiagnosticsOptions;
    /**
     * **Internal debugging option — not for regular consumers.** Lets someone
     * debugging the built package leave the job-list browser (`jobList`) and/or
     * the company-page lookup's own context (`companyPage`) open after
     * `runScrape` finishes, instead of being closed as usual. Only takes effect
     * when `headless: false` is also set — there's no window to inspect on a
     * headless run, so it's ignored there and that case always closes normally.
     */
    _closeBrowserAfterScrape?: {
        jobList?: boolean;
        companyPage?: boolean;
    };
}

export interface RunScrapeOptions {
    onProgress?: (event: ScrapeProgressEvent) => void;
    /**
     * When aborted, `runScrape` stops at the next safe checkpoint (between jobs in
     * `scrapeAllJobsOnce`/`retryStaleJobs`, or during the job-loading polling loops)
     * and rejects with `ScrapeAbortedError` instead of resolving — the browser is
     * still always closed via `runScrape`'s own `finally` block first.
     */
    signal?: AbortSignal;
    searchParams: SearchParams;
    scraperOptions?: ScraperOptions;
}

export type RunScraper = (options: RunScrapeOptions) => Promise<ScrapeOutcome>;

/**
 * Every combination the three staleness flags can be in, as a **closed** set
 * of keys: `'none'`, one key per single flag, and one per pair and for the
 * triple, with the parts always joined in the order `company` →
 * `sourceJobId` → `lateOverlay`.
 *
 * Enumerable on purpose. GitHub issue #29 asks not only which combinations
 * fire but *which never occur* — and "never occurred" is only answerable
 * against a key set fixed up front, so `StaleReport.byCombination` carries
 * all eight keys with explicit zeros rather than only the ones a particular
 * run happened to hit.
 */
export type StaleFlagCombination =
    | 'none'
    | 'company'
    | 'sourceJobId'
    | 'lateOverlay'
    | 'company+sourceJobId'
    | 'company+lateOverlay'
    | 'sourceJobId+lateOverlay'
    | 'company+sourceJobId+lateOverlay';

/**
 * What one Playwright wait in the per-job path actually did.
 *
 * The detail title-link visibility wait and the subsequent network-idle wait
 * remain best-effort signals, so their rejections are recorded rather than
 * propagated. The exact parsed-ID comparison is the gate that now decides
 * whether detail fields may be read; these observations explain what the
 * waits did without being used as proof of identity themselves.
 */
export interface WaitObservation {
    /**
     * `'resolved'` — the wait completed on its own. `'timedOut'` — it
     * rejected and the rejection was swallowed (a `waitFor`/`waitForLoadState`
     * has no realistic rejection other than its own timeout, so every
     * swallowed one is recorded as this). `'skipped'` — the wait was never
     * issued at all. The detail-pane gate no longer reaches that state in a
     * normal scrape because list identity rejects a missing `sourceJobId`
     * before the card is clicked; it remains in the type for compatibility
     * with direct helper callers and older diagnostic records.
     */
    outcome: 'resolved' | 'timedOut' | 'skipped';
    /** Wall-clock milliseconds the wait actually took; `0` for a `'skipped'` one. */
    elapsedMs: number;
    /**
     * The timeout handed to Playwright **after** `JobBudget` clamping, not
     * the wait's own local cap. That distinction is the point: a wait cut
     * short because the job had 300ms of budget left is a different finding
     * from one that genuinely burned its full 8s, and only the clamped number
     * tells them apart. `0` for a `'skipped'` wait, where nothing was handed
     * to Playwright at all.
     */
    timeoutMs: number;
}

/**
 * One exact comparison between the clicked card and the detail pane after an
 * activation. The title-link wait is only a trigger; `matched` is derived by
 * parsing the href and comparing the complete posting IDs.
 */
export interface DetailPaneIdentityObservation {
    attempt: 'initial' | 'immediate-reclick';
    expectedJobId: string | null;
    detailTitleHref: string | null;
    detailJobId: string | null;
    matched: boolean;
    wait: WaitObservation;
}

/**
 * A raw look at the detail pane at the moment its data was read, captured in
 * one `page.evaluate` by the internal `readDetailPaneSnapshot`.
 *
 * Exists to settle GitHub issue #29's first hypothesis — that LinkedIn
 * serves an interstitial or decoy pane distinct enough from the known
 * sign-in nag that `findVisibleOverlay` never matches it. A stale pane, a
 * partially-rendered pane and an interstitial are indistinguishable from the
 * scraped fields alone; they are not indistinguishable from the markup.
 */
export interface DetailPaneSnapshot {
    /**
     * The pane's `outerHTML` with all whitespace collapsed to single spaces
     * and the result cut to `StaleDiagnosticsOptions.maxSnapshotChars` —
     * capped in the browser, exactly like `OverlayDiagnostics.text`, so one
     * runaway pane cannot bloat a whole run's report.
     */
    html: string;
    /** The pane container's own class list in DOM order; `[]` when no container matched and the capture fell back to `document.body`. */
    classes: string[];
    /**
     * The `href` of **every** detail title link on the page, in DOM order —
     * not `.first()`. `readJobDetailPane` reads only the first one, so a pane
     * holding two topcards at once (the old one and the new one, mid-swap)
     * would look perfectly ordinary there. Two entries here is that finding.
     */
    titleLinkHrefs: string[];
    /** The text of **every** detail-pane company link, in DOM order, kept in full for the same reason `titleLinkHrefs` is. */
    orgNames: string[];
    /** Whether a description element existed at all — an empty pane and a pane with an empty description are different failures. */
    hasDescription: boolean;
    /** Character count of the collapsed description text; `0` when `hasDescription` is false. */
    descriptionLength: number;
    /**
     * The class list of every element matching `OVERLAY_SELECTOR` at read
     * time, one array per overlay, read across the whole document rather
     * than within the pane (LinkedIn renders its modals in a container of
     * their own). `[]` means nothing matched — which, on a job flagged
     * `lateOverlayDetected`, is itself evidence.
     */
    visibleOverlayClasses: string[][];
}

/** One overlay probe in a job, retained in chronological order. */
export interface OverlayCheck {
    phase: 'pre-click' | 'post-click' | 'late';
    /** The click attempt this preceded; null outside the pre-click ladder. */
    attempt: number | null;
    /** False when the job budget was too small to run the clear. */
    ran: boolean;
    startedAt: number;
    elapsedMs: number;
    observed: boolean;
    dismissed: boolean;
    neutralized: boolean;
    stillBlocking: boolean;
    diagnostics: OverlayDiagnostics | null;
    diagnosticsReadFailed: boolean;
}

export type SnapshotCaptureOutcome =
    | 'not-requested'
    | 'captured'
    | 'skipped-budget'
    | 'failed';

/**
 * Everything observed while scraping one job, recorded whether or not that
 * job turned out stale.
 *
 * The healthy jobs are the denominator: without them "this combination never
 * occurs" and "this condition co-occurs with staleness" are both
 * unanswerable, so one of these is emitted per clicked job rather than only
 * for the suspect ones.
 *
 * Fields are assigned as they are observed, onto a mutable record the
 * recorder hands back on `finalize()` — mirroring `readJobListIdentity`'s
 * `identity` object — so a job that throws partway still reports what it saw
 * up to that point. A `null` here therefore means "never got that far", not
 * "read and came back empty"; the two numeric read-offsets use `-1` for the
 * same "never happened" reason, since `0` is a legitimate offset.
 */
export interface StaleDiagnostics {
    /** Stable identity for the run, so concatenated reports never infer boundaries from array order. */
    runId: string;
    /** Number of logical unique-posting indices considered after maxJobs is applied. */
    totalJobs: number;
    /** The job's index in the run, matching `JobResult.index`. */
    index: number;
    /** Which pass produced this record: the ordinary sweep, or `retryStaleJobs`' single re-scrape of an index the first pass flagged. */
    pass: 'first' | 'retry';
    /** The result variant this attempt ultimately produced. */
    resultStatus: JobStatus;
    /** The three flags below folded into one closed key; `'none'` when nothing fired. */
    combination: StaleFlagCombination;
    /** Exactly `JobResult.companyMismatch` for this scrape. */
    companyMismatch: boolean;
    /** Exactly `JobResult.sourceJobIdMismatch` for this scrape. */
    sourceJobIdMismatch: boolean;
    /** Exactly `JobResult.lateOverlayDetected` for this scrape. */
    lateOverlayDetected: boolean;
    /** The clicked card's own posting ID; `null` when the list identity was never read. */
    sourceJobId: string | null;
    /** The company text on the list card — the left-hand side of `companyMismatch`. */
    listCompany: string | null;
    /** The title text on the list card, so a leftover pane can be named against the job that was actually clicked. */
    listTitle: string | null;
    /** The clicked card's normalized posting URL. */
    sourceUrl: string | null;
    /** The company text the detail pane showed — the right-hand side of `companyMismatch`. */
    detailCompany: string | null;
    /** The detail pane's own title-link `href`, exactly as read (unresolved, unnormalized). */
    detailTitleHref: string | null;
    /**
     * `detailTitleHref` put through the same `normalizeJobUrl` +
     * `jobIdFromUrl` pipeline `isSourceJobIdMismatch` uses, so a leftover
     * pane can be traced to *which* previously-clicked job it belonged to —
     * or shown to belong to none of them. `null` when the href was missing
     * or carried no ID.
     */
    detailJobId: string | null;
    /** Epoch ms at which the click was issued; `-1` when the job never got as far as clicking. */
    clickStartedAt: number;
    /** How long `clickWithOverlayRetries` took, its overlay clears and retries included; `-1` when the click never completed. */
    clickDurationMs: number;
    /** The detail pane's title-link wait; `null` when `waitForJobDetailToLoad` was never reached. */
    titleLinkWait: WaitObservation | null;
    /**
     * Ordered exact identity checks for the initial activation and, when
     * needed, the one immediate recovery re-click. Optional so stored records
     * produced before v0.12 remain consumable.
     */
    detailIdentityChecks?: DetailPaneIdentityObservation[];
    /** The `networkidle` wait; `null` when `waitForJobDetailToLoad` was never reached. */
    networkIdleWait: WaitObservation | null;
    /** Milliseconds from the click completing to the detail company being read; `-1` when that read never happened. */
    msToCompanyRead: number;
    /** Milliseconds from the click completing to the description being read; `-1` when that read never happened. */
    msToDescriptionRead: number;
    /** Milliseconds from the click completing to the detail title href being read; `-1` when that read never happened. */
    msToTitleHrefRead: number;
    /** How many click attempts `clickWithOverlayRetries` made; `0` when the click was never reached. */
    clickAttempts: number;
    /** Every overlay clear performed or skipped during this job, in chronological order. */
    overlayChecks: OverlayCheck[];
    /** Exactly `JobResult.duplicateOfIdx` — the index of this posting's first occurrence in the run, or `null`. */
    duplicateOfIdx: number | null;
    /**
     * The pane's markup at read time; `null` unless
     * `StaleDiagnosticsOptions.domSnapshot` is on *and* this job either
     * fired a flag or `snapshotEveryJob` was set. Capturing healthy jobs too
     * is the only way to tell a stale pane from a partially-rendered one —
     * that comparison needs a baseline.
     */
    snapshot: DetailPaneSnapshot | null;
    snapshotOutcome: SnapshotCaptureOutcome;
    /** Error from the snapshot read when snapshotOutcome is failed; null otherwise. */
    snapshotError: string | null;
}

/**
 * One observable condition's stale rate with and without it — the table that
 * is the actual deliverable of GitHub issue #29's diagnostic phase.
 *
 * A raw count of how often a condition appears alongside a stale job proves
 * nothing on its own: a condition that holds for 90% of a run "co-occurs"
 * with almost everything. Reporting both sides makes the comparison the
 * useful one — a condition whose `withCondition.rate` is far above its
 * `withoutCondition.rate` is a candidate mechanism; one where the two match
 * is background.
 */
export interface ConditionCoOccurrence {
    /** Stable machine-readable label, e.g. `'titleLinkWait:timedOut'`. */
    condition: string;
    /** Jobs where the condition held. `rate` is `stale / total`, and `0` when `total` is `0`. */
    withCondition: { total: number; stale: number; rate: number };
    /** Jobs where it did not. Same `rate` convention. */
    withoutCondition: { total: number; stale: number; rate: number };
}

/**
 * A whole run's stale diagnostics, aggregated by `summarizeStaleDiagnostics`.
 *
 * Built from a flat `StaleDiagnostics[]` rather than from a run object, so a
 * consumer can concatenate the records of several runs and re-summarize them
 * as one. Each record's runId and totalJobs keep boundaries and positions
 * explicit rather than inferred from array order.
 */
export interface StaleReport {
    /** Every record handed in, jobs that failed before the detail pane included. */
    totalRecords: number;
    /** Successful first-pass jobs: the denominator for staleRate and conditions. */
    successfulJobs: number;
    /** Successful first-pass jobs with a non-none flag combination. */
    staleJobs: number;
    /** `staleJobs / successfulJobs`, or `0` when no pane was ever read. The number GitHub issue #29 reports as ~0.33. */
    staleRate: number;
    /** Stale count per flag combination, with **all eight** keys present — the zeros are the answer to "which combinations never occur". */
    byCombination: Record<StaleFlagCombination, number>;
    /** Stale counts split at the midpoint of each pass's own index range, to test whether staleness is a late-in-the-run effect. */
    byRunPosition: { firstHalf: number; secondHalf: number };
    /** How many stale records were immediately preceded — same run, same pass, adjacent index — by a duplicate job. */
    followedDuplicate: number;
    /** How many stale records were immediately preceded — same run, same pass, adjacent index — by another stale job. */
    followedStale: number;
    /** Every maximal run of **two or more** consecutive stale indices, in order. An empty array means staleness never came in runs. */
    clusters: { runId: string; startIndex: number; length: number }[];
    /** The longest run of consecutive stale indices, counting an isolated stale job as `1`; `0` when nothing was stale. */
    longestCluster: number;
    /** Records with `pass: 'retry'`. */
    retriesAttempted: number;
    /** Retry records that came back clean at an index whose first pass was stale or failed the detail identity gate. */
    retriesRecovered: number;
    /** Immediate identity recovery across every diagnostic record. */
    identityRecovery: { attempted: number; recovered: number; failed: number };
    /** The co-occurrence table, one entry per observable condition, in a fixed order. */
    conditions: ConditionCoOccurrence[];
    /** Every record the report was built from, kept so a written-out report is self-contained. */
    records: StaleDiagnostics[];
}

/**
 * Switches for the stale-scrape diagnostics (GitHub issue #29); see
 * `ScraperOptions.staleDiagnostics`.
 */
export interface StaleDiagnosticsOptions {
    /**
     * Whether records are collected at all. Default `true`: every field but
     * the snapshot is a value the scrape already computed — timestamps,
     * booleans, strings it read anyway — so collection costs no extra
     * browser round-trips. `false` skips the recorder entirely, leaving
     * `ScrapeOutcome.staleReport` and both job events' `diagnostics` absent.
     * It does not disable identity verification or either recovery path.
     */
    enabled?: boolean;
    /**
     * Whether to capture `StaleDiagnostics.snapshot`. Default `false`: it is
     * one extra `page.evaluate` per captured job, and the only part of these
     * diagnostics that costs a round-trip.
     */
    domSnapshot?: boolean;
    /**
     * Whether to snapshot healthy jobs too, not just flagged ones. Default
     * `false`. Worth turning on for a dedicated diagnostic run: telling a
     * stale pane apart from a partially-rendered or interstitial one needs a
     * healthy pane to compare it against. Ignored unless `domSnapshot` is on.
     */
    snapshotEveryJob?: boolean;
    /** Cap on `DetailPaneSnapshot.html`, applied in the browser before the markup crosses back. Default `4000`. */
    maxSnapshotChars?: number;
}
