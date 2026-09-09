import type { Page } from 'playwright';
import { collectJobListState } from './collectJobListState';
import { sleep } from './sleep';

export interface JobListCounts {
    rawCount: number;
    uniqueCount: number;
}

// A "See more jobs" response arrives asynchronously after its click. Poll
// until either raw cards or distinct postings change: an overlapping batch
// can advance LinkedIn's pagination without increasing the unique count, and
// the caller must be allowed to click again rather than treating that batch
// as exhaustion.
export async function pollForJobListProgress(
    page: Page,
    previousRawCount: number,
    previousUniqueCount: number,
    signal?: AbortSignal,
): Promise<JobListCounts> {
    let currentState: JobListCounts = {
        rawCount: previousRawCount,
        uniqueCount: previousUniqueCount,
    };
    for (let poll = 0; poll < 10; poll++) {
        if (signal?.aborted) break;
        await sleep(300);
        currentState = await collectJobListState(page);
        if (
            currentState.rawCount !== previousRawCount ||
            currentState.uniqueCount !== previousUniqueCount
        ) {
            break;
        }
    }
    return currentState;
}
