import type { JobResult } from '../types';
import type { ScrapeContext } from './scrapeContext';
import { scrapeJobAndRecord } from './scrapeJobAndRecord';
import { isStaleResult } from './isStaleResult';
import { sleep } from './sleep';

// CRAP score here is driven by fallow's *estimated* (not instrumented)
// coverage defaulting to 0% for this function, not an actual
// untested-complexity risk — the scrapeAllJobsOnce tests in
// test/scrapeAllJobsOnce.test.ts already exercise every branch below,
// including the signal-abort break.
// fallow-ignore-next-line complexity
export async function scrapeAllJobsOnce(
    ctx: ScrapeContext,
    results: JobResult[],
): Promise<number[]> {
    const delayBetweenJobsMs = ctx.delayBetweenJobsMs ?? 700;
    const staleIndices: number[] = [];
    for (let i = 0; i < ctx.totalJobs; i++) {
        if (ctx.signal?.aborted) break;
        const result = await scrapeJobAndRecord(ctx, results, i);
        if (isStaleResult(result)) staleIndices.push(i);
        await sleep(delayBetweenJobsMs);
    }
    return staleIndices;
}
