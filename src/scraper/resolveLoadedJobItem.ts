import type { Locator, Page } from 'playwright';
import type { LoadedJob } from './collectJobListState';
import { collectJobListState } from './collectJobListState';
import { jobItemsLocator } from './jobItemsLocator';

// Re-read the lightweight list mapping before every first-pass/retry scrape
// so a parseable posting is selected by identity, not by an old raw position.
// If LinkedIn removed it, the original position is only a failure target: the
// caller retains the expected ID and refuses to trust a different card
// that may now occupy that slot.
export async function resolveLoadedJobItem(
    page: Page,
    loadedJob: LoadedJob,
): Promise<Locator> {
    if (loadedJob.sourceJobId === null) {
        return jobItemsLocator(page).nth(loadedJob.rawIndex);
    }

    const currentState = await collectJobListState(page);
    const currentJob = currentState.uniqueJobs.find(
        (job) => job.sourceJobId === loadedJob.sourceJobId,
    );
    return jobItemsLocator(page).nth(
        currentJob?.rawIndex ?? loadedJob.rawIndex,
    );
}
