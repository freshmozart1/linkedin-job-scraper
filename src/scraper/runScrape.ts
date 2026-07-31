import { chromium } from 'playwright';
import type { RunScraper, RunScrapeOptions } from '../types';
import type { CompanyLookup } from '../companyLookup';
import { buildSearchUrl } from '../url';
import { createCompanyLookup } from '../companyLookup';
import type { ScrapeContext } from './scrapeContext';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import { loadAllJobs } from './loadAllJobs';
import { clampTotalJobs } from './clampTotalJobs';
import { scrapeAllJobsOnce } from './scrapeAllJobsOnce';
import { retryStaleJobs } from './retryStaleJobs';
import { ScrapeAbortedError } from './ScrapeAbortedError';
import type { JobResult } from '../types';

export const runScrape: RunScraper = async ({
    onProgress,
    signal,
    searchParams,
    scraperOptions,
}: RunScrapeOptions) => {
    // Part of building each job's fallbackTitle (see scrapeJob) — just needs to
    // vary per run, nothing more.
    const runTimestamp = Date.now();
    const searchUrl = buildSearchUrl(searchParams);
    const results: JobResult[] = [];

    // Checked before the browser even launches so an already-aborted signal never
    // pays for one — nothing to clean up yet, so this stays outside the try/finally
    // below for the same reason a failing `launch` does.
    if (signal?.aborted) throw new ScrapeAbortedError({ results, url: searchUrl });

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

        const discoveredJobs = await loadAllJobs(
            page,
            scraperOptions,
            onProgress,
            signal,
        );
        if (signal?.aborted)
            throw new ScrapeAbortedError({ results, url: searchUrl });
        const totalJobs = clampTotalJobs(discoveredJobs, scraperOptions?.maxJobs);
        onProgress?.({ type: 'jobs:found', total: totalJobs });

        const ctx: ScrapeContext = {
            page,
            totalJobs,
            seenSourceJobIds: new Map(),
            onProgress,
            runTimestamp,
            delayBetweenJobsMs: scraperOptions?.delayBetweenJobsMs,
            clickRetryAttempts: scraperOptions?.clickRetryAttempts,
            companyLookup,
            signal,
        };

        const staleIndices = await scrapeAllJobsOnce(ctx, results);
        if (signal?.aborted)
            throw new ScrapeAbortedError({ results, url: searchUrl });
        await retryStaleJobs(ctx, results, staleIndices);
        if (signal?.aborted)
            throw new ScrapeAbortedError({ results, url: searchUrl });

        return { results, url: searchUrl };
    } finally {
        // Debug-only escape hatch; only applies to headed runs (see ScraperOptions).
        const closeAfterScrape =
            scraperOptions?.headless === false
                ? scraperOptions?._closeBrowserAfterScrape
                : undefined;

        // Optional-chained: setup can now throw before the lookup exists.
        if (closeAfterScrape?.companyPage ?? true) {
            await companyLookup?.close().catch(() => {});
        }
        if (closeAfterScrape?.jobList ?? true) {
            await browser.close();
        }
    }
};
