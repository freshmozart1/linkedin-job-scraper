import type { JobResult } from '../types';
import type { LoadedJob } from './collectJobListState';
import type { ScrapeContext } from './scrapeContext';
import { isRetryableResult } from './isRetryableResult';
import { scrapeJobAndRecord } from './scrapeJobAndRecord';
import { sleep } from './sleep';

// runScrape's first pass over the ordered unique-card mapping. Logical result
// indices stay contiguous even when their corresponding raw DOM positions do
// not; the public scrapeAllJobsOnce retains its raw-index contract separately.
export async function scrapeLoadedJobsOnce(
    ctx: ScrapeContext,
    results: JobResult[],
    loadedJobs: readonly LoadedJob[],
): Promise<number[]> {
    const delayBetweenJobsMs = ctx.delayBetweenJobsMs ?? 700;
    const retryIndices: number[] = [];
    for (let index = 0; index < loadedJobs.length; index++) {
        if (ctx.signal?.aborted) break;
        const loadedJob = loadedJobs[index]!;
        const result = await scrapeJobAndRecord(ctx, results, index, {
            loadedJob,
        });
        if (isRetryableResult(result)) retryIndices.push(index);
        await sleep(delayBetweenJobsMs);
    }
    return retryIndices;
}
