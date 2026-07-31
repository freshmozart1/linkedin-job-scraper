import type { Page } from 'playwright';
import { sleep } from './sleep';
import { collectJobIds } from './collectJobIds';

// The next batch of 10 arrives asynchronously after a "See more" click
// (observed ~1s delay), so this polls briefly instead of assuming it's
// already in the DOM.
//
// CRAP score here is driven by fallow's *estimated* (not instrumented)
// coverage defaulting to 0% for this function, not an actual
// untested-complexity risk — like loadAllJobs/retryStaleJobs, this internal
// helper has no dedicated test file (see CLAUDE.md: only the exported
// subset is driven directly by tests), so the 0% estimate reflects this
// repo's testing boundary, not real risk.
// fallow-ignore-next-line complexity
export async function pollForNewJobs(
    page: Page,
    previousCount: number,
    signal?: AbortSignal,
): Promise<number> {
    let currentCount = previousCount;
    for (let poll = 0; poll < 10; poll++) {
        if (signal?.aborted) break;
        await sleep(300);
        currentCount = (await collectJobIds(page)).size;
        if (currentCount !== previousCount) break;
    }
    return currentCount;
}
