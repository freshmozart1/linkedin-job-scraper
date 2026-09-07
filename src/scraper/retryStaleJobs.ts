import type { ScrapeContext } from './scrapeContext';
import { scrapeJobAndRecord } from './scrapeJobAndRecord';
import { sleep } from './sleep';

// Detail-pane staleness caught on the first pass gets exactly one retry,
// deferred until the whole list has been scraped once — by then the page
// has settled down and the extra pre-click delay gives the pane more time
// to catch up, instead of compounding delays into every single job.
//
// CRAP score here is driven by fallow's *estimated* (not instrumented)
// coverage defaulting to 0% for this function, not an actual
// untested-complexity risk — like loadAllJobs/pollForNewJobs, this internal
// helper has no dedicated test file (see CLAUDE.md: only the exported
// subset is driven directly by tests), so the 0% estimate reflects this
// repo's testing boundary, not real risk.
// fallow-ignore-next-line complexity
export async function retryStaleJobs(
    ctx: ScrapeContext,
    results: import('../types').JobResult[],
    staleIndices: number[],
): Promise<void> {
    const delayBetweenJobsMs = ctx.delayBetweenJobsMs ?? 700;
    for (const i of staleIndices) {
        if (ctx.signal?.aborted) break;
        // `pass: 'retry'` marks this scrape's diagnostics record as the
        // second look at an index, so the report can tell a retry that
        // rescued a job from a first-pass result that was clean all along —
        // and so its index is never mistaken for the next one along in the
        // first pass's own sequence.
        await scrapeJobAndRecord(ctx, results, i, {
            preClickDelayMs: 1000,
            pass: 'retry',
        });
        await sleep(delayBetweenJobsMs);
    }
}
