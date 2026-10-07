import type { JobResult, StaleDiagnostics } from '../types';
import type { ScrapeContext } from './scrapeContext';
import { scrapeJob, type ScrapeJobOptions } from './scrapeJob';
import { scrapeJobFromLocator } from './scrapeJobFromLocator';
import { isStaleResult } from './isStaleResult';
import type { LoadedJob } from './collectJobListState';
import { resolveLoadedJobItem } from './resolveLoadedJobItem';

export async function scrapeJobAndRecord(
    ctx: ScrapeContext,
    results: JobResult[],
    index: number,
    options: {
        preClickDelayMs?: number;
        /** Which pass this call belongs to; `retryStaleJobs` is the only caller that passes `'retry'`. */
        pass?: 'first' | 'retry';
        /** Unique runScrape target; absent preserves the public raw-index path. */
        loadedJob?: LoadedJob;
    } = {},
): Promise<JobResult> {
    ctx.onProgress?.({ type: 'job:start', index, total: ctx.totalJobs });
    // Captured on the way past rather than returned by scrapeJob, because
    // scrapeJob emits it from its catch block too — where there is no
    // successful return to hang it on.
    let diagnostics: StaleDiagnostics | undefined;
    const scrapeOptions: ScrapeJobOptions = {
        preClickDelayMs: options.preClickDelayMs,
        seenSourceJobIds: ctx.seenSourceJobIds,
        runTimestamp: ctx.runTimestamp,
        clickRetryAttempts: ctx.clickRetryAttempts,
        companyLookup: ctx.companyLookup,
        shouldScrapeJob: ctx.shouldScrapeJob,
        perJobTimeoutMs: ctx.perJobTimeoutMs,
        // The signal goes *into* the job, not just around it: checked only
        // between jobs, an abort could not take effect until the in-flight
        // job finished — up to the ~100s a stuck one can take.
        signal: ctx.signal,
        runTimeBudget: ctx.runTimeBudget,
        // The only route the overlay helpers have to the progress stream and
        // to the caller's overlay tier policy: everything under scrapeJob is
        // several calls deep and holds no reference to either otherwise.
        overlayClear: { ...ctx.overlayClear, onProgress: ctx.onProgress },
        staleDiagnostics: ctx.staleDiagnostics,
        diagnosticsPass: options.pass,
        diagnosticsRunId: ctx.runId,
        diagnosticsTotalJobs: ctx.totalJobs,
        // Absent when the run turned diagnostics off, which is what makes
        // scrapeJob skip creating a recorder at all.
        onJobDiagnostics: ctx.onJobDiagnostics
            ? (record) => {
                  diagnostics = record;
                  ctx.onJobDiagnostics?.(record);
              }
            : undefined,
    };
    let result: JobResult;
    if (options.loadedJob) {
        const jobItem = await resolveLoadedJobItem(
            ctx.page,
            options.loadedJob,
        );
        result = await scrapeJobFromLocator(
            ctx.page,
            index,
            jobItem,
            options.loadedJob.sourceJobId,
            scrapeOptions,
        );
    } else {
        result = await scrapeJob(ctx.page, index, scrapeOptions);
    }
    results[index] = result; // indexed write (not push) so a retry replaces, not appends
    ctx.onProgress?.(
        isStaleResult(result)
            ? { type: 'job:stale', result, diagnostics }
            : { type: 'job:done', result, diagnostics },
    );
    return result;
}
