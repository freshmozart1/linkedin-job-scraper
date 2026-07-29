// Playwright driver for LinkedIn's public/guest job search results: loads
// all jobs via infinite scroll, clicks every job card in the list, and
// scrapes title/company/description for each one.
//
// Guest/unauthenticated view only — no login, no credentials. LinkedIn's
// markup and anti-bot gating can change or vary by session (this page can
// show a dismissible "sign in to view more jobs" nag at any point, even on
// initial load), so this is still scraping an unofficial, moving surface.

import { chromium } from 'playwright';
import type { Page, Locator } from 'playwright';
import { buildSearchUrl, jobIdFromUrl } from './url';
import {
    JOB_LIST_SELECTOR,
    SEE_MORE_BUTTON_SELECTOR,
    VIEWED_ALL_JOBS_SELECTOR,
    LIST_COMPANY_SELECTOR,
    LIST_COMPANY_LINK_SELECTOR,
    LIST_LOCATION_SELECTOR,
    LIST_POSTED_AT_SELECTOR,
    COMPANY_SELECTOR,
    DESCRIPTION_SELECTOR,
    JOB_LINK_SELECTOR,
    JOB_CRITERIA_VALUE_SELECTOR,
} from './selectors';
import { createCompanyLookup } from './companyLookup';
import type { CompanyLookup } from './companyLookup';
import type {
    CompanyMismatchCheck,
    JobResult,
    RunScraper,
    RunScrapeOptions,
    ScraperOptions,
    ScrapeProgressEvent,
} from './types';

interface OverlayClearOptions {
    timeoutMs?: number;
    pollIntervalMs?: number;
    requiredConsecutiveClear?: number;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Scoped to `ul.jobs-search__results-list` rather than a generic `main ul`
// so this can never accidentally match LinkedIn's separate
// `ul.similar-titles__list` ("Related searches") elsewhere on the page. The
// h3-filter is defense-in-depth on top of that scoping: LinkedIn's guest job
// list can still append a handful of trailing, non-job `<li>`s after the real
// cards (no title, clicking them doesn't change the detail pane), and scoping
// to items that actually contain a title heading keeps the counted total and
// the indexed element in sync, so the scrape loop never runs past the real
// list.
function jobItemsLocator(page: Page): Locator {
    return page.locator(JOB_LIST_SELECTOR).filter({ has: page.locator('h3') });
}

// LinkedIn's guest detail pane sometimes doesn't re-render when jobs are
// clicked in quick succession: the title link updates (scrapeJob already
// waits for that) but the rest of the pane is left over from the previously
// clicked job. Comparing the company name shown in the list item (which
// doesn't change on click) against the company name read from the detail
// pane catches that case directly, regardless of which job it leaked from.
export function isCompanyMismatch({
    listCompany,
    detailCompany,
}: CompanyMismatchCheck): boolean {
    if (!listCompany || !detailCompany) return false;
    return listCompany.trim() !== detailCompany.trim();
}

// A "stale" result is a successful scrape whose data might be untrustworthy:
// the detail-pane company disagreed with the list, or a sign-in overlay was
// still visible right when the data was read. `status: 'failed'` never
// counts — scrapeJob's catch block always forces both flags false on
// failure, so this predicate excludes failures without a separate check.
export function isStaleResult(result: JobResult): boolean {
    return (
        result.status === 'success' &&
        (result.companyMismatch || result.lateOverlayDetected)
    );
}

// Registers this occurrence of a LinkedIn posting ID and returns the index of
// the earlier job it duplicates, or null if it's the first occurrence.
// Later occurrences must NOT repoint the map: it has to keep naming the first
// occurrence so every duplicate (and the stale-retry pass, which re-scrapes a
// job at its own index and must not see itself as a duplicate) resolves to
// the same first index.
export function registerJobOccurrence(
    seenSourceJobIds: Map<string, number>,
    sourceJobId: string | null,
    index: number,
): number | null {
    if (sourceJobId === null) return null;
    const firstSeenIndex = seenSourceJobIds.get(sourceJobId);
    if (firstSeenIndex === undefined) {
        seenSourceJobIds.set(sourceJobId, index);
        return null;
    }
    return firstSeenIndex === index ? null : firstSeenIndex;
}

// LinkedIn's guest pages block all clicks behind a `.modal__overlay--visible`
// (the cookie consent banner on load, later a "Sign in to view more jobs"
// nag). Both share the same overlay/dialog structure with a dismiss-style
// button (Reject / Accept / Dismiss), so one generic poll-and-click routine
// handles both instead of hardcoding to one specific dialog.
//
// The overlay can render asynchronously (a beat after `domcontentloaded`),
// so this polls rather than checking once — it only concludes "nothing to
// dismiss" after several consecutive not-visible reads, not on the first one.
async function findVisibleOverlay(page: Page): Promise<Locator | null> {
    // `.modal__overlay--visible` is the class LinkedIn actually toggles to make
    // an overlay block pointer events (confirmed via computed style: opacity 1,
    // visibility visible, pointer-events auto). A broader `[role="dialog"]` /
    // `[role="alert"]` selector also matches unrelated, always-visible
    // accessibility live-regions that appear earlier in the DOM, which made
    // `.first()` pick the wrong element — so this stays narrow on purpose.
    const overlay = page.locator('.modal__overlay--visible').first();
    return (await overlay.isVisible().catch(() => false)) ? overlay : null;
}

export async function clearBlockingOverlays(
    page: Page,
    {
        timeoutMs = 15000,
        pollIntervalMs = 250,
        requiredConsecutiveClear = 4,
    }: OverlayClearOptions = {},
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let dismissedAny = false;
    let consecutiveNotVisible = 0;

    while (Date.now() < deadline) {
        const overlay = await findVisibleOverlay(page);

        if (!overlay) {
            consecutiveNotVisible += 1;
            if (consecutiveNotVisible >= requiredConsecutiveClear) break;
            await sleep(pollIntervalMs);
            continue;
        }

        consecutiveNotVisible = 0;
        const button = overlay
            .getByRole('button', { name: /reject|dismiss|accept/i })
            .first();
        try {
            await button.click({ timeout: 2000 });
            dismissedAny = true;
            await overlay
                .waitFor({ state: 'hidden', timeout: 3000 })
                .catch(() => {});
        } catch {
            await sleep(pollIntervalMs);
        }
    }

    return dismissedAny;
}

// LinkedIn's guest infinite scroll can, on a long enough session, stop
// returning genuinely new pages and instead re-serve an earlier page (a
// pagination cursor / bot-detection reset, by the look of it — a clean,
// non-interleaved repeat of the first N jobs, not random duplication).
// Counting raw `<li>` nodes can't tell a repeated page apart from a new one,
// so track the set of distinct job IDs instead: once that stops growing, the
// unique results are exhausted even if the DOM keeps appending more nodes.
async function collectJobIds(page: Page): Promise<Set<string>> {
    const ids = await page.evaluate(() => {
        // Runs in the browser context; this package compiles without the DOM
        // lib, so only the specific members used here are typed structurally.
        interface MinimalElement {
            querySelector(selector: string): MinimalElement | null;
            getAttribute(name: string): string | null;
        }
        const g = globalThis as unknown as {
            document: {
                querySelectorAll(selector: string): ArrayLike<MinimalElement>;
            };
        };
        // Also hardcoded literally here (page.evaluate serializes the callback
        // via toString(), so it can't close over selectors.ts's export) — keep
        // in sync with JOB_LIST_SELECTOR in ./selectors if this ever changes.
        const lis = Array.from(
            g.document.querySelectorAll('ul.jobs-search__results-list > li'),
        ).filter((li) => li.querySelector('h3'));
        return lis.map((li, i) => {
            const urn =
                li
                    .querySelector('.base-card')
                    ?.getAttribute('data-entity-urn') ?? '';
            const match = urn.match(/jobPosting:(\d+)$/);
            return match?.[1] ?? `__unparseable_${i}`;
        });
    });
    return new Set(ids);
}

export interface ScrollLoadPhaseOptions {
    maxScrollAttempts?: number;
    stableScrollsToStop?: number;
    onProgress?: (event: ScrapeProgressEvent) => void;
}

// Phase A: LinkedIn's own scroll-triggered infinite scroll, which loads jobs
// in batches of 10 automatically until the list reaches 120 items — at that
// point LinkedIn hides this behavior behind a manual "See more jobs" button
// instead (Phase B below), so stop scrolling the moment that button appears
// rather than waiting for scroll growth to go stable on its own (it can
// appear before that happens). Returns the unique job count once scrolling
// stops, as the starting point for Phase B.
export async function scrollLoadPhase(
    page: Page,
    seeMoreButton: Locator,
    options: ScrollLoadPhaseOptions = {},
): Promise<number> {
    const {
        maxScrollAttempts = 60,
        stableScrollsToStop = 3,
        onProgress,
    } = options;
    let previousUniqueCount = 0;
    let stableReads = 0;

    for (let attempt = 0; attempt < maxScrollAttempts; attempt++) {
        const currentUniqueCount = (await collectJobIds(page)).size;

        if (currentUniqueCount === previousUniqueCount) {
            stableReads += 1;
            if (stableReads >= stableScrollsToStop) break;
        } else {
            stableReads = 0;
            onProgress?.({ type: 'jobs:loading', count: currentUniqueCount });
        }

        previousUniqueCount = currentUniqueCount;

        if (await seeMoreButton.isVisible().catch(() => false)) break;

        // Runs in the browser context; this package compiles without the DOM
        // lib, so the browser globals are named through a structural cast.
        await page.evaluate(() => {
            const g = globalThis as unknown as {
                scrollTo(x: number, y: number): void;
                document: { body: { scrollHeight: number } };
            };
            g.scrollTo(0, g.document.body.scrollHeight);
        });
        await sleep(800);
    }

    return previousUniqueCount;
}

// Phase B: past 120 items LinkedIn requires clicking "See more jobs" for each
// further batch of 10 instead of auto-loading on scroll. Click through
// clickWithOverlayRetries() (defined below, alongside the job-card click
// loop) since the sign-in nag can reappear here too, and stop once LinkedIn's
// own "You've viewed all jobs for this search" banner appears, the button
// itself goes away, or growth stalls for several consecutive clicks (the
// same stale/repeated-page risk collectJobIds() already guards against in
// Phase A).
// The next batch of 10 arrives asynchronously after a "See more" click
// (observed ~1s delay), so poll briefly instead of assuming it's already in
// the DOM.
async function pollForNewJobs(
    page: Page,
    previousCount: number,
): Promise<number> {
    let currentCount = previousCount;
    for (let poll = 0; poll < 10; poll++) {
        await sleep(300);
        currentCount = (await collectJobIds(page)).size;
        if (currentCount !== previousCount) break;
    }
    return currentCount;
}

export interface ClickLoadPhaseOptions {
    maxSeeMoreClicks?: number;
    stableClicksToStop?: number;
    clickRetryAttempts?: number;
    onProgress?: (event: ScrapeProgressEvent) => void;
}

export async function clickLoadPhase(
    page: Page,
    seeMoreButton: Locator,
    initialUniqueCount: number,
    options: ClickLoadPhaseOptions = {},
): Promise<void> {
    const {
        maxSeeMoreClicks = 200,
        stableClicksToStop = 3,
        clickRetryAttempts,
        onProgress,
    } = options;
    const viewedAllBanner = page.locator(VIEWED_ALL_JOBS_SELECTOR);
    let stableClicks = 0;
    let previousUniqueCount = initialUniqueCount;

    for (let attempt = 0; attempt < maxSeeMoreClicks; attempt++) {
        if (await viewedAllBanner.isVisible().catch(() => false)) break;
        if (!(await seeMoreButton.isVisible().catch(() => false))) break;

        const beforeClickCount = previousUniqueCount;
        await clickWithOverlayRetries(seeMoreButton, page, clickRetryAttempts);
        const currentUniqueCount = await pollForNewJobs(page, beforeClickCount);

        if (currentUniqueCount === beforeClickCount) {
            stableClicks += 1;
            if (stableClicks >= stableClicksToStop) break;
        } else {
            stableClicks = 0;
            onProgress?.({ type: 'jobs:loading', count: currentUniqueCount });
        }
        previousUniqueCount = currentUniqueCount;
    }
}

async function loadAllJobs(
    page: Page,
    scraperOptions: ScraperOptions | undefined,
    onProgress?: (event: ScrapeProgressEvent) => void,
): Promise<number> {
    const seeMoreButton = page.locator(SEE_MORE_BUTTON_SELECTOR);
    const afterScrollCount = await scrollLoadPhase(page, seeMoreButton, {
        maxScrollAttempts: scraperOptions?.maxScrollAttempts,
        stableScrollsToStop: scraperOptions?.stableScrollsToStop,
        onProgress,
    });
    await clickLoadPhase(page, seeMoreButton, afterScrollCount, {
        maxSeeMoreClicks: scraperOptions?.maxSeeMoreClicks,
        stableClicksToStop: scraperOptions?.stableClicksToStop,
        clickRetryAttempts: scraperOptions?.clickRetryAttempts,
        onProgress,
    });
    return (await collectJobIds(page)).size;
}

// The sign-in wall can pop up *during* a click attempt (not just before it),
// e.g. triggered by the scrolling/loading that happened moments earlier. A
// single long click() with a fixed timeout can get stuck retrying against an
// overlay that appeared mid-wait, since nothing dismisses it while Playwright
// is inside its own click retry loop. So instead: short click attempts,
// actively clearing overlays between each one.
async function clickWithOverlayRetries(
    locator: Locator,
    page: Page,
    maxAttempts = 4,
): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await clearBlockingOverlays(page, {
            timeoutMs: 4000,
            requiredConsecutiveClear: 2,
            pollIntervalMs: 200,
        });
        try {
            await locator.click({ timeout: 4000 });
            return;
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            await sleep(500);
        }
    }
}

export interface ScrapeJobOptions {
    preClickDelayMs?: number;
    seenSourceJobIds: Map<string, number>;
    runTimestamp: number;
    clickRetryAttempts?: number;
    companyLookup: CompanyLookup;
}

interface JobIdentity {
    listCompany: string | null;
    sourceJobId: string | null;
    sourceUrl: string | null;
    companyUrl: string | null;
    location: string | null;
    postedAt: string | null;
}

async function dismissOverlayAfterClick(page: Page): Promise<void> {
    const dismissed = await clearBlockingOverlays(page, {
        timeoutMs: 8000,
        requiredConsecutiveClear: 2,
        pollIntervalMs: 200,
    });
    if (dismissed) return;
    const stillBlocked = (await findVisibleOverlay(page)) !== null;
    if (stillBlocked) {
        throw new Error(
            'Blocked by LinkedIn sign-in wall (could not dismiss dialog)',
        );
    }
}

// The detail pane re-renders client-side after a click; networkidle alone
// doesn't guarantee that DOM patch has landed (it only tracks network quiet
// time), so wait for the detail pane's own title link to actually reference
// this job's ID before trusting its content.
async function waitForJobDetailToLoad(
    page: Page,
    sourceJobId: string | null,
): Promise<void> {
    if (sourceJobId) {
        await page
            .locator(`a[href*="topcard-title"][href*="-${sourceJobId}"]`)
            .first()
            .waitFor({ state: 'visible', timeout: 8000 })
            .catch(() => {});
    }

    await page
        .waitForLoadState('networkidle', { timeout: 5000 })
        .catch(() => {});
}

// The "sign in to view more jobs" nag can render asynchronously at any point
// (see file header comment), including in the gap after the text reads —
// re-check right before finishing this job so a late-appearing overlay
// doesn't silently taint the already-read company/description/tags data
// without being flagged. Returns whether the overlay was still visible at
// that point.
async function checkForLateOverlay(page: Page): Promise<boolean> {
    const dismissed = await clearBlockingOverlays(page, {
        timeoutMs: 3000,
        requiredConsecutiveClear: 2,
        pollIntervalMs: 150,
    });
    return !dismissed && (await findVisibleOverlay(page)) !== null;
}

export async function scrapeJob(
    page: Page,
    index: number,
    total: number,
    options: ScrapeJobOptions,
): Promise<JobResult> {
    const jobItem = jobItemsLocator(page).nth(index);
    // Hoisted so the catch below can return whatever identity was captured
    // before a later failure, instead of losing it along with the rest of
    // the job.
    let title: string | null = null;
    let sourceJobId: string | null = null;
    let sourceUrl: string | null = null;
    let sourceHostname: string | null = null;
    let companyUrl: string | null = null;
    let location: string | null = null;
    let postedAt: string | null = null;
    // Hoisted so the catch return keeps the marker when a duplicate's scrape
    // fails partway through.
    let duplicateOfIdx: number | null = null;
    try {
        await jobItem.scrollIntoViewIfNeeded();
        // Belt-and-suspenders: jobItemsLocator() already excludes `<li>`s
        // without an `<h3>`, but if LinkedIn's markup shifts and a non-job
        // item slips through anyway, don't click it and fabricate a
        // "success" record for it — bail out before touching the page at
        // all.
        const firstH3 = jobItem.locator('h3').first();
        const noTitleError = new Error(
            'No job title found for this list item - LinkedIn markup has likely changed',
        );
        if ((await firstH3.count()) === 0) throw noTitleError;
        const trim = async <T = string | string[] | null>(
            locator: string,
            { attr, page: p }: { attr?: string; page?: Page } = {},
        ) => {
            const isJobCriteria = locator === JOB_CRITERIA_VALUE_SELECTOR;
            const el = (isJobCriteria && p ? p : (p ?? jobItem))
                .locator(locator)
                .first();
            try {
                if (isJobCriteria && p)
                    return (await el
                        .waitFor({ state: 'attached', timeout: 1000 })
                        .catch(() => {})
                        .then(() =>
                            p
                                .locator(JOB_CRITERIA_VALUE_SELECTOR)
                                .allInnerTexts(),
                        )
                        .then((texts) =>
                            texts.map((t) => t.trim()).filter(Boolean),
                        )) as T;
                const val = attr
                    ? await el.getAttribute(attr, { timeout: 1000 })
                    : await el.innerText({ timeout: 1000 });
                return (val?.trim() || '') as unknown as T;
            } catch {
                return (isJobCriteria ? null : '') as unknown as T;
            }
        };
        title = await trim<string>('h3');
        if (!title) throw noTitleError;
        const jobHref = await trim(JOB_LINK_SELECTOR, { attr: 'href' });
        if (!jobHref) throw new Error('No job href found for this list item');
        const jobUrl = new URL(jobHref, page.url());
        if (!jobUrl.hostname)
            throw new Error('No job URL hostname found for this list item');
        sourceHostname = jobUrl.hostname;
        jobUrl.search = ''; // normalize to a canonical URL without query params
        jobUrl.hash = ''; // normalize to a canonical URL without fragment
        sourceUrl = jobUrl.toString();
        const entityUrn = await trim<string>('.base-card', {
            attr: 'data-entity-urn',
        });
        sourceJobId =
            entityUrn.match(/jobPosting:(\d+)$/)?.[1] ??
            jobIdFromUrl(sourceUrl) ??
            '';
        if (!sourceJobId)
            throw new Error(
                'No source job ID found for job item - LinkedIn markup has likely changed',
            );
        const companyHref = await trim(LIST_COMPANY_LINK_SELECTOR, {
            attr: 'href',
        });
        if (!companyHref)
            throw new Error('No company href found for list item');
        const _companyUrl = new URL(companyHref, page.url());
        if (!_companyUrl.hostname)
            throw new Error('No company URL hostname found for list item');
        _companyUrl.search = '';
        _companyUrl.hash = '';
        companyUrl = _companyUrl.toString();
        location = await trim(LIST_LOCATION_SELECTOR);
        if (!location) throw new Error('No location found for list item');
        postedAt = await trim(LIST_POSTED_AT_SELECTOR, { attr: 'datetime' });
        if (!postedAt) throw new Error('No posted date found for list item');
        // Duplicates (repeated pages from LinkedIn's list-loading pagination) are
        // scraped in full like any other job — they're only marked, so the
        // caller can hide or show them.
        duplicateOfIdx = registerJobOccurrence(
            options.seenSourceJobIds,
            sourceJobId,
            index,
        );

        if (options.preClickDelayMs) await sleep(options.preClickDelayMs);

        await clickWithOverlayRetries(
            jobItem,
            page,
            options.clickRetryAttempts,
        );
        await dismissOverlayAfterClick(page);
        await waitForJobDetailToLoad(page, sourceJobId);
        const company = await trim<string>(COMPANY_SELECTOR, { page });
        if (!company) throw new Error('No company in detail pane for job');
        const descriptionText = await trim<string>(DESCRIPTION_SELECTOR, {
            page,
        });
        if (!descriptionText)
            throw new Error('No description text found for list item');
        const companyMismatch = isCompanyMismatch({
            listCompany: await trim(LIST_COMPANY_SELECTOR),
            detailCompany: company,
        });

        const lateOverlayDetected = await checkForLateOverlay(page);

        // Deliberately after checkForLateOverlay: that check has to stay tight
        // against the company/description reads it validates, and this lookup can
        // take seconds. Run in between, it would make lateOverlayDetected describe
        // a moment well after the data it's supposed to vouch for.
        //
        // The lookup drives its own page on its own context, so it can't disturb
        // this page or its detail pane, and it never rejects — a company page
        // that's blocked or missing yields null instead of failing the job.
        const companyAddresses =
            await options.companyLookup.addressesFor(companyUrl);
        const tags = await trim<string[] | null>(JOB_CRITERIA_VALUE_SELECTOR, {
            page,
        });
        if (tags === null)
            throw new Error('No job criteria found for job item');
        return {
            index,
            title,
            company,
            descriptionText,
            status: 'success',
            companyMismatch,
            lateOverlayDetected,
            sourceJobId,
            sourceUrl,
            sourceHostname,
            scrapedAt: new Date().toISOString(),
            duplicateOfIdx,
            companyUrl,
            companyAddresses,
            location,
            postedAt,
            tags,
        };
    } catch (error) {
        return {
            index,
            title,
            company: null,
            descriptionText: null,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            companyMismatch: false,
            lateOverlayDetected: false,
            sourceJobId,
            sourceUrl,
            sourceHostname,
            scrapedAt: new Date().toISOString(),
            duplicateOfIdx,
            companyUrl,
            companyAddresses: null,
            location,
            postedAt,
            tags: null,
        };
    }
}

export interface ScrapeContext {
    page: Page;
    totalJobs: number;
    seenSourceJobIds: Map<string, number>;
    onProgress?: (event: ScrapeProgressEvent) => void;
    runTimestamp: number;
    delayBetweenJobsMs?: number;
    clickRetryAttempts?: number;
    companyLookup: CompanyLookup;
}

async function scrapeJobAndRecord(
    ctx: ScrapeContext,
    results: JobResult[],
    index: number,
    options: { preClickDelayMs?: number } = {},
): Promise<JobResult> {
    ctx.onProgress?.({ type: 'job:start', index, total: ctx.totalJobs });
    const result = await scrapeJob(ctx.page, index, ctx.totalJobs, {
        ...options,
        seenSourceJobIds: ctx.seenSourceJobIds,
        runTimestamp: ctx.runTimestamp,
        clickRetryAttempts: ctx.clickRetryAttempts,
        companyLookup: ctx.companyLookup,
    });
    results[index] = result; // indexed write (not push) so a retry replaces, not appends
    ctx.onProgress?.(
        isStaleResult(result)
            ? { type: 'job:stale', result }
            : { type: 'job:done', result },
    );
    return result;
}

export async function scrapeAllJobsOnce(
    ctx: ScrapeContext,
    results: JobResult[],
): Promise<number[]> {
    const delayBetweenJobsMs = ctx.delayBetweenJobsMs ?? 700;
    const staleIndices: number[] = [];
    for (let i = 0; i < ctx.totalJobs; i++) {
        const result = await scrapeJobAndRecord(ctx, results, i);
        if (isStaleResult(result)) staleIndices.push(i);
        await sleep(delayBetweenJobsMs);
    }
    return staleIndices;
}

// Detail-pane staleness caught on the first pass gets exactly one retry,
// deferred until the whole list has been scraped once — by then the page
// has settled down and the extra pre-click delay gives the pane more time
// to catch up, instead of compounding delays into every single job.
async function retryStaleJobs(
    ctx: ScrapeContext,
    results: JobResult[],
    staleIndices: number[],
): Promise<void> {
    const delayBetweenJobsMs = ctx.delayBetweenJobsMs ?? 700;
    for (const i of staleIndices) {
        await scrapeJobAndRecord(ctx, results, i, { preClickDelayMs: 1000 });
        await sleep(delayBetweenJobsMs);
    }
}

export const runScrape: RunScraper = async ({
    onProgress,
    searchParams,
    scraperOptions,
}: RunScrapeOptions) => {
    // Part of building each job's fallbackTitle (see scrapeJob) — just needs to
    // vary per run, nothing more.
    const runTimestamp = Date.now();
    const searchUrl = buildSearchUrl(searchParams);

    const browser = await chromium.launch({
        headless: scraperOptions?.headless ?? false,
    });
    // Everything past the launch belongs inside the try: each step below can
    // throw, and from here on there is a real Chromium process that has to be
    // closed. (A failing `launch` leaves nothing to clean up, so it stays out.)
    let companyLookup: CompanyLookup | null = null;

    try {
        const context = await browser.newContext({
            viewport: scraperOptions?.viewport ?? { width: 1440, height: 900 },
        });
        const page = await context.newPage();
        // Its own context, not this one — the lookup clears cookies before every
        // company page it opens, which would throw away the guest search session.
        companyLookup = await createCompanyLookup(
            browser,
            scraperOptions?.companyLookup,
        );

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

        await clearBlockingOverlays(page, {
            timeoutMs: scraperOptions?.overlayClear?.timeoutMs ?? 15000,
            requiredConsecutiveClear:
                scraperOptions?.overlayClear?.requiredConsecutiveClear ?? 5,
            pollIntervalMs: scraperOptions?.overlayClear?.pollIntervalMs ?? 300,
        });

        const totalJobs = await loadAllJobs(page, scraperOptions, onProgress);
        onProgress?.({ type: 'jobs:found', total: totalJobs });

        const results: JobResult[] = [];
        const ctx: ScrapeContext = {
            page,
            totalJobs,
            seenSourceJobIds: new Map(),
            onProgress,
            runTimestamp,
            delayBetweenJobsMs: scraperOptions?.delayBetweenJobsMs,
            clickRetryAttempts: scraperOptions?.clickRetryAttempts,
            companyLookup,
        };

        const staleIndices = await scrapeAllJobsOnce(ctx, results);
        await retryStaleJobs(ctx, results, staleIndices);

        return { results, url: searchUrl };
    } finally {
        // Optional-chained: setup can now throw before the lookup exists.
        await companyLookup?.close().catch(() => {});
        await browser.close();
    }
};
