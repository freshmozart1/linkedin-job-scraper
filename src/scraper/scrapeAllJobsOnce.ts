import type { JobResult } from '../types';
import type { ScrapeContext } from './scrapeContext';
import { scrapeJobAndRecord } from './scrapeJobAndRecord';
import { isStaleResult } from './isStaleResult';
import { sleep } from './sleep';

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
