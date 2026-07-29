import type { SearchParams } from './types';

const SEARCH_BASE_URL = 'https://www.linkedin.com/jobs/search';

// LinkedIn's public guest-search query codes for `f_TPR` (time posted range).
const DATE_POSTED_CODES: Record<
    NonNullable<SearchParams['datePosted']>,
    string
> = {
    day: 'r86400',
    week: 'r604800',
    month: 'r2592000',
};

// `f_E` experience-level codes.
const EXPERIENCE_LEVEL_CODES: Record<
    NonNullable<SearchParams['experienceLevels']>[number],
    string
> = {
    internship: '1',
    entry: '2',
    associate: '3',
    'mid-senior': '4',
    director: '5',
    executive: '6',
};

// `f_JT` job-type codes.
const JOB_TYPE_CODES: Record<
    NonNullable<SearchParams['jobTypes']>[number],
    string
> = {
    'full-time': 'F',
    'part-time': 'P',
    contract: 'C',
    temporary: 'T',
    volunteer: 'V',
    internship: 'I',
    other: 'O',
};

// `f_WT` workplace-type codes.
const WORKPLACE_TYPE_CODES: Record<
    NonNullable<SearchParams['workplaceTypes']>[number],
    string
> = {
    'on-site': '1',
    remote: '2',
    hybrid: '3',
};

// `sortBy` codes.
const SORT_BY_CODES: Record<NonNullable<SearchParams['sortBy']>, string> = {
    relevance: 'R',
    date: 'DD',
};

/**
 * Builds a LinkedIn guest job-search URL from caller-supplied search
 * parameters. Only `keyword` is required; every other field is optional
 * and, when omitted, simply isn't sent as a query param — nothing here is
 * defaulted or hardcoded.
 */
export function buildSearchUrl(params: SearchParams): string {
    const url = new URL(SEARCH_BASE_URL);
    url.searchParams.set('keywords', params.keyword);

    if (params.location !== undefined)
        url.searchParams.set('location', params.location);
    if (params.geoId !== undefined) url.searchParams.set('geoId', params.geoId);
    if (params.datePosted !== undefined)
        url.searchParams.set('f_TPR', DATE_POSTED_CODES[params.datePosted]);
    if (
        params.experienceLevels !== undefined &&
        params.experienceLevels.length > 0
    ) {
        url.searchParams.set(
            'f_E',
            params.experienceLevels
                .map((level) => EXPERIENCE_LEVEL_CODES[level])
                .join(','),
        );
    }
    if (params.jobTypes !== undefined && params.jobTypes.length > 0) {
        url.searchParams.set(
            'f_JT',
            params.jobTypes.map((type) => JOB_TYPE_CODES[type]).join(','),
        );
    }
    if (
        params.workplaceTypes !== undefined &&
        params.workplaceTypes.length > 0
    ) {
        url.searchParams.set(
            'f_WT',
            params.workplaceTypes
                .map((type) => WORKPLACE_TYPE_CODES[type])
                .join(','),
        );
    }
    if (params.distanceMiles !== undefined)
        url.searchParams.set('distance', String(params.distanceMiles));
    if (params.sortBy !== undefined)
        url.searchParams.set('sortBy', SORT_BY_CODES[params.sortBy]);

    for (const [key, value] of Object.entries(params.extraParams ?? {})) {
        url.searchParams.set(key, value);
    }

    return url.toString();
}

// ---------------------------------------------------------------------------
// Job result URLs
//
// The functions below work on the *other* kind of URL this package touches:
// not the search URL it builds, but the per-job URLs it scrapes out of the
// result list. Both are pure, and all three are exported so a consumer can
// re-derive them from a stored `sourceUrl` instead of trusting a stale field.
// ---------------------------------------------------------------------------

/**
 * Turns a scraped `href` into a stable, absolute LinkedIn URL, or null when it
 * isn't one.
 *
 * Three things happen here, each for a reason:
 * - **Resolution against `baseUrl`.** `getAttribute` returns the raw attribute,
 *   not the resolved property, so a relative href stays relative. LinkedIn's
 *   guest search re-renders client-side and never navigates, so the search URL
 *   remains a correct base for the whole run.
 * - **Dropping the query and fragment.** The card href carries a per-session
 *   `refId`/`trackingId` plus `position`/`pageNum` (and `?trk=` on the company
 *   link), so the same target yields a different URL on every run — which
 *   breaks any consumer deduping or upserting on this field. `position`/
 *   `pageNum` also just restate `index`.
 * - **Rejecting hostname-less URLs.** `new URL('javascript:void(0)')` parses
 *   without throwing and reports an empty hostname, so a try/catch alone would
 *   let junk through. Nothing without a hostname is a usable URL.
 */
function normalizeLinkedInUrl(
    href: string | null | undefined,
    baseUrl: string,
): string | null {
    if (!href) return null;
    let url: URL;
    try {
        url = new URL(href, baseUrl);
    } catch {
        return null;
    }
    if (!url.hostname) return null;
    url.search = '';
    url.hash = '';
    return url.toString();
}

/** Stable, absolute URL of an individual job posting. See `normalizeLinkedInUrl`. */
export function normalizeJobUrl(
    href: string | null | undefined,
    baseUrl: string,
): string | null {
    return normalizeLinkedInUrl(href, baseUrl);
}

/**
 * Stable, absolute URL of a company's LinkedIn page, e.g.
 * `https://de.linkedin.com/company/yatta-solutions-gmbh`. Same normalization
 * as `normalizeJobUrl` — the company link carries its own `?trk=` tracking
 * param, and this URL is what the run's address cache is keyed on, so it has
 * to be identical across every card of the same company.
 */
export function normalizeCompanyUrl(
    href: string | null | undefined,
    baseUrl: string,
): string | null {
    return normalizeLinkedInUrl(href, baseUrl);
}

/**
 * Hostname of a job URL, e.g. `de.linkedin.com` — LinkedIn serves individual
 * postings from country-specific subdomains, so this varies job to job within
 * one run. Null for anything that isn't a URL with a hostname.
 */
export function hostnameOf(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        // `.hostname` is '' (not an error) for schemes like `javascript:` and
        // `mailto:`, so the `|| null` is doing real work here.
        return new URL(url).hostname || null;
    } catch {
        return null;
    }
}

/**
 * LinkedIn's numeric posting ID, recovered from the trailing `-<id>` segment
 * of a job URL. This is a second, independent carrier of the same ID that
 * `data-entity-urn` holds — worth having, because losing the ID silently
 * disables both duplicate detection and the detail-pane wait.
 */
export function jobIdFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    return url.match(/-(\d+)\/?$/)?.[1] ?? null;
}
