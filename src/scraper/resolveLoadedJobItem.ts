import type { Locator, Page } from 'playwright';
import type { LoadedJob } from './collectJobListState';
import { collectJobListState } from './collectJobListState';
import { jobItemsLocator } from './jobItemsLocator';

export interface ResolvedLoadedJobItem {
    jobItem: Locator;
    expectedSourceJobId: string | null;
}

// Re-read the lightweight list mapping before every first-pass/retry scrape
// so a parseable posting is selected by identity, not by an old raw position.
// If LinkedIn removed it, the original position is only a failure target: the
// caller also receives the expected ID and refuses to trust a different card
// that may now occupy that slot.
export async function resolveLoadedJobItem(
    page: Page,
    loadedJob: LoadedJob,
): Promise<ResolvedLoadedJobItem> {
    if (loadedJob.sourceJobId === null) {
        return {
            jobItem: jobItemsLocator(page).nth(loadedJob.rawIndex),
            expectedSourceJobId: null,
        };
    }

    const currentState = await collectJobListState(page);
    const currentJob = currentState.uniqueJobs.find(
        (job) => job.sourceJobId === loadedJob.sourceJobId,
    );
    return {
        jobItem: jobItemsLocator(page).nth(
            currentJob?.rawIndex ?? loadedJob.rawIndex,
        ),
        expectedSourceJobId: loadedJob.sourceJobId,
    };
}
