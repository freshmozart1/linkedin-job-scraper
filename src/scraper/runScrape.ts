import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import type { RunScraper, RunScrapeOptions } from '../types';
import type { CompanyLookup } from '../companyLookup';
import { buildSearchUrl } from '../url';
import { createCompanyLookup } from '../companyLookup';
import type { ScrapeContext } from './scrapeContext';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import { toOverlayClearSettings } from './toOverlayClearSettings';
import { loadAllJobs } from './loadAllJobs';
import { clampTotalJobs } from './clampTotalJobs';
import { scrapeAllJobsOnce } from './scrapeAllJobsOnce';
import { retryStaleJobs } from './retryStaleJobs';
import { ScrapeAbortedError } from './ScrapeAbortedError';
import { createRunTimeBudget } from './runTimeBudget';
import { summarizeStaleDiagnostics } from './summarizeStaleDiagnostics';
import type { JobResult, ScrapeOutcome, StaleDiagnostics } from '../types';

export const runScrape: RunScraper = async ({
    onProgress,
    signal,
    searchParams,
    scraperOptions,
}: RunScrapeOptions) => {
    // Part of building each job's fallbackTitle (see scrapeJob) — just needs to
    // vary per run, nothing more.
    const runTimestamp = Date.now();
    const runId = randomUUID();
    const searchUrl = buildSearchUrl(searchParams);
    const results: JobResult[] = [];

    // Deliberately the *caller's* signal, not the composed one below: an
    // already-aborted caller signal still rejects, and the run budget's timer
    // cannot have fired at this instant anyway.
    //
    // Checked before the browser even launches so an already-aborted signal never
    // pays for one — nothing to clean up yet, so this stays outside the try/finally
    // below for the same reason a failing `launch` does.
    if (signal?.aborted)
        throw new ScrapeAbortedError({ results, url: searchUrl });

    // Started before the launch so it measures the whole run, browser startup
    // included. From here on `runBudget.signal` is what every phase is given,
    // so the checkpoints that already stop on an abort stop on an expired run
    // budget too; only this function still tells the two apart.
    const runBudget = createRunTimeBudget(
        scraperOptions?.maxRunDurationMs,
        signal,
    );
    // One accumulator for both scrape passes (GitHub issue #29). Diagnostics
    // are on unless the caller says otherwise: every field but the DOM
    // snapshot is a value the scrape already computed, so collecting them
    // costs no extra browser round-trips. Turning them off leaves
    // `onJobDiagnostics` absent, which is what stops a recorder from ever
    // being created down in scrapeJob.
    const diagnosticsEnabled =
        scraperOptions?.staleDiagnostics?.enabled ?? true;
    const staleRecords: StaleDiagnostics[] = [];
    // Attached to every return path, the early ones included: a run that
    // stopped short still observed everything it got through, and that
    // partial evidence is exactly what a diagnostic run is after. `undefined`
    // — not an empty report — when diagnostics are off, so "collected
    // nothing" stays distinguishable from "collected nothing because nobody
    // asked".
    const staleReport = () =>
        diagnosticsEnabled
            ? summarizeStaleDiagnostics(staleRecords)
            : undefined;
    // Spelled out once rather than at each of the three checkpoints below,
    // which were returning byte-identical objects and could quietly drift.
    const stoppedOnRunBudget = (): ScrapeOutcome => ({
        results,
        url: searchUrl,
        stoppedEarly: 'run-time-budget',
        staleReport: staleReport(),
    });

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
            maxDismissAttempts:
                scraperOptions?.overlayClear?.maxDismissAttempts ?? 2,
            neutralizeStuckOverlay:
                scraperOptions?.overlayClear?.neutralizeStuckOverlay ?? true,
            onProgress,
        });

        const discoveredJobs = await loadAllJobs(
            page,
            scraperOptions,
            onProgress,
            runBudget.signal,
        );
        // The caller's abort is checked first at every one of these three
        // checkpoints, and always wins: a caller who asked to stop gets the
        // rejection they expect even if the run budget expired in the same
        // moment. An expired budget on its own is something the caller asked
        // for too — so it resolves with what the run has, rather than
        // throwing away every job already scraped.
        if (signal?.aborted)
            throw new ScrapeAbortedError({ results, url: searchUrl });
        if (runBudget.exceededReason()) return stoppedOnRunBudget();
        const totalJobs = clampTotalJobs(
            discoveredJobs,
            scraperOptions?.maxJobs,
        );
        onProgress?.({ type: 'jobs:found', total: totalJobs });

        const ctx: ScrapeContext = {
            runId,
            page,
            totalJobs,
            seenSourceJobIds: new Map(),
            onProgress,
            runTimestamp,
            delayBetweenJobsMs: scraperOptions?.delayBetweenJobsMs,
            clickRetryAttempts: scraperOptions?.clickRetryAttempts,
            companyLookup,
            signal: runBudget.signal,
            shouldScrapeJob: scraperOptions?.shouldScrapeJob,
            perJobTimeoutMs: scraperOptions?.perJobTimeoutMs,
            // Alongside the composed `signal` above, not folded into it: a
            // job the budget's timer catches mid-flight needs to name the
            // run's clock rather than report `Scrape aborted` for a caller
            // who never aborted anything.
            runTimeBudget: runBudget,
            // Carried per job so `neutralizeStuckOverlay` / `maxDismissAttempts`
            // reach the three in-job clear sites too, not just the clear above.
            overlayClear: toOverlayClearSettings(scraperOptions),
            staleDiagnostics: scraperOptions?.staleDiagnostics,
            onJobDiagnostics: diagnosticsEnabled
                ? (record) => {
                      staleRecords.push(record);
                  }
                : undefined,
        };

        const staleIndices = await scrapeAllJobsOnce(ctx, results);
        if (signal?.aborted)
            throw new ScrapeAbortedError({ results, url: searchUrl });
        if (runBudget.exceededReason()) return stoppedOnRunBudget();
        await retryStaleJobs(ctx, results, staleIndices);
        if (signal?.aborted)
            throw new ScrapeAbortedError({ results, url: searchUrl });
        // The stale-retry pass is the last thing a run does, so a budget that
        // expired during it cost the run nothing but those retries — the
        // first-pass results are all in `results` already. It is still
        // reported, because "some jobs kept a suspect first-pass result" is
        // exactly what a consumer would want to know.
        if (runBudget.exceededReason()) return stoppedOnRunBudget();

        // No `stoppedEarly`: absent means the run scraped every job it found.
        // The report is built here, after both passes, so it covers the
        // retries as well as the first sweep.
        return { results, url: searchUrl, staleReport: staleReport() };
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
