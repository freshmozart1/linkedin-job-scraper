import type { Page } from 'playwright';
import type { ScrapeProgressEvent, ShouldScrapeJob } from '../types';
import type { CompanyLookup } from '../companyLookup';
import type { OverlayClearSettings } from './clearBlockingOverlays';

export interface ScrapeContext {
    page: Page;
    totalJobs: number;
    seenSourceJobIds: Map<string, number>;
    onProgress?: (event: ScrapeProgressEvent) => void;
    runTimestamp: number;
    delayBetweenJobsMs?: number;
    clickRetryAttempts?: number;
    companyLookup: CompanyLookup;
    /**
     * The run's composed abort signal — the caller's own, plus any
     * `maxRunDurationMs` timer (see `createRunTimeBudget`). Read between jobs
     * here, and threaded into each job's own budget so it also lands inside
     * one.
     */
    signal?: AbortSignal;
    shouldScrapeJob?: ShouldScrapeJob;
    /** Per-job wall-clock budget; see `ScraperOptions.perJobTimeoutMs`. */
    perJobTimeoutMs?: number;
    /**
     * The caller's `ScraperOptions.overlayClear` tier policy, carried per job
     * so it reaches the three in-job clear sites and not just the one
     * `runScrape` performs after `page.goto`. `onProgress` is added on top of
     * it in scrapeJobAndRecord, which is where the run's own callback lives.
     */
    overlayClear?: Omit<OverlayClearSettings, 'onProgress'>;
}
