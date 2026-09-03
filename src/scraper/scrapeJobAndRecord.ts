import type { JobResult } from '../types';
import type { ScrapeContext } from './scrapeContext';
import { scrapeJob } from './scrapeJob';
import { isStaleResult } from './isStaleResult';

export async function scrapeJobAndRecord(
    ctx: ScrapeContext,
    results: JobResult[],
    index: number,
    options: { preClickDelayMs?: number } = {},
): Promise<JobResult> {
    ctx.onProgress?.({ type: 'job:start', index, total: ctx.totalJobs });
    const result = await scrapeJob(ctx.page, index, {
        ...options,
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
        // The only route the overlay helpers have to the progress stream and
        // to the caller's overlay tier policy: everything under scrapeJob is
        // several calls deep and holds no reference to either otherwise.
        overlayClear: { ...ctx.overlayClear, onProgress: ctx.onProgress },
    });
    results[index] = result; // indexed write (not push) so a retry replaces, not appends
    ctx.onProgress?.(
        isStaleResult(result)
            ? { type: 'job:stale', result }
            : { type: 'job:done', result },
    );
    return result;
}
