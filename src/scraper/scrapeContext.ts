import type { Page } from 'playwright';
import type {
    RunTimeBudget,
    ScrapeProgressEvent,
    ShouldScrapeJob,
    StaleDiagnostics,
    StaleDiagnosticsOptions,
} from '../types';
import type { CompanyLookup } from '../companyLookup';
import type { OverlayClearSettings } from './clearBlockingOverlays';

export interface ScrapeContext {
    /** Stable run identity; runScrape always sets it, while direct test/helper callers may omit it. */
    runId?: string;
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
     * The run's own budget, carried alongside `signal` rather than folded
     * into it, so a job caught in flight can say *which* of the two composed
     * reasons stopped it. Only `runScrape` holds them apart.
     */
    runTimeBudget?: RunTimeBudget;
    /**
     * The caller's `ScraperOptions.overlayClear` tier policy, carried per job
     * so it reaches the three in-job clear sites and not just the one
     * `runScrape` performs after `page.goto`. `onProgress` is added on top of
     * it in scrapeJobAndRecord, which is where the run's own callback lives.
     */
    overlayClear?: Omit<OverlayClearSettings, 'onProgress'>;
    /**
     * Snapshot switches for the stale diagnostics; see
     * `ScraperOptions.staleDiagnostics`. Carried per job because the one
     * place that reads them (`readJobDetailPane`) is three calls below here.
     */
    staleDiagnostics?: StaleDiagnosticsOptions;
    /**
     * Where each job's finished diagnostics record goes — the run's
     * accumulator, which `runScrape` then hands to
     * `summarizeStaleDiagnostics`. Absent when
     * `ScraperOptions.staleDiagnostics.enabled` is `false`, and that absence
     * is what turns the whole mechanism off: no collector ⇒ no recorder ⇒
     * every instrumented helper runs its uninstrumented path.
     *
     * One collector for both passes, deliberately. A retry that comes back
     * clean is only interesting next to the first-pass record it replaced, so
     * `scrapeAllJobsOnce` and `retryStaleJobs` accumulate into the same list
     * rather than the retry overwriting the evidence the way
     * `results[index]` does.
     */
    onJobDiagnostics?: (record: StaleDiagnostics) => void;
}
