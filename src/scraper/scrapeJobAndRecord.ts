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
    });
    results[index] = result; // indexed write (not push) so a retry replaces, not appends
    ctx.onProgress?.(
        isStaleResult(result)
            ? { type: 'job:stale', result }
            : { type: 'job:done', result },
    );
    return result;
}
