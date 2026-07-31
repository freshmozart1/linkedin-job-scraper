import type { Page } from 'playwright';
import { sleep } from './sleep';
import { collectJobIds } from './collectJobIds';

// The next batch of 10 arrives asynchronously after a "See more" click
// (observed ~1s delay), so this polls briefly instead of assuming it's
// already in the DOM.
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
