import type { ScrapeContext } from './scrapeContext';
import { scrapeJobAndRecord } from './scrapeJobAndRecord';
import { sleep } from './sleep';

// Detail-pane staleness caught on the first pass gets exactly one retry,
// deferred until the whole list has been scraped once — by then the page
// has settled down and the extra pre-click delay gives the pane more time
// to catch up, instead of compounding delays into every single job.
export async function retryStaleJobs(
    ctx: ScrapeContext,
    results: import('../types').JobResult[],
    staleIndices: number[],
): Promise<void> {
    const delayBetweenJobsMs = ctx.delayBetweenJobsMs ?? 700;
    for (const i of staleIndices) {
        await scrapeJobAndRecord(ctx, results, i, { preClickDelayMs: 1000 });
        await sleep(delayBetweenJobsMs);
    }
}
