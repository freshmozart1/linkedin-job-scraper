import type { Page, Locator } from 'playwright';
import type { ScrapeProgressEvent } from '../types';
import { VIEWED_ALL_JOBS_SELECTOR } from '../selectors';
import { clickWithOverlayRetries } from './clickWithOverlayRetries';
import type { OverlayClearSettings } from './clearBlockingOverlays';
import { collectJobListState } from './collectJobListState';
import { pollForJobListProgress } from './pollForJobListProgress';
import { createJobBudget } from './jobBudget';

export interface ClickLoadPhaseOptions {
    maxSeeMoreClicks?: number;
    stableClicksToStop?: number;
    clickRetryAttempts?: number;
    onProgress?: (event: ScrapeProgressEvent) => void;
    /** The caller's overlay tier policy, so a clear during this phase obeys it too; see OverlayClearSettings. */
    overlayClear?: Omit<OverlayClearSettings, 'onProgress'>;
    signal?: AbortSignal;
}

// Phase B: past 120 items LinkedIn requires clicking "See more jobs" for
// each further batch of 10 instead of auto-loading on scroll. Click through
// clickWithOverlayRetries() (./clickWithOverlayRetries) since the sign-in
// nag can reappear here too, and stop once LinkedIn's own "You've viewed
// all jobs for this search" banner appears, the button itself goes away, or
// both raw-card and unique-job growth stall for several consecutive clicks.
// LinkedIn can append an overlapping batch made entirely of duplicate IDs;
// that is pagination progress worth another click, but never a reason to
// inflate jobs:loading or the final unique total (GitHub issue #39).
export async function clickLoadPhase(
    page: Page,
    seeMoreButton: Locator,
    initialUniqueCount: number,
    options: ClickLoadPhaseOptions = {},
): Promise<void> {
    const {
        maxSeeMoreClicks = 200,
        stableClicksToStop = 3,
        clickRetryAttempts,
        onProgress,
        overlayClear,
        signal,
    } = options;
    // Reuse the click helper's stop checks without imposing a per-job
    // deadline on discovery. The composed signal also carries the run timer.
    const budget = createJobBudget({ perJobTimeoutMs: 0, signal });
    const viewedAllBanner = page.locator(VIEWED_ALL_JOBS_SELECTOR);
    let stableClicks = 0;
    let previousUniqueCount = initialUniqueCount;
    let previousRawCount: number | null = null;

    for (let attempt = 0; attempt < maxSeeMoreClicks; attempt++) {
        if (signal?.aborted) break;
        if (await viewedAllBanner.isVisible().catch(() => false)) break;
        if (!(await seeMoreButton.isVisible().catch(() => false))) break;

        previousRawCount ??= (await collectJobListState(page)).rawCount;
        const beforeClickRawCount = previousRawCount;
        const beforeClickCount = previousUniqueCount;
        await clickWithOverlayRetries(seeMoreButton, page, {
            maxAttempts: clickRetryAttempts,
            overlayClear: { ...overlayClear, onProgress },
            budget,
        });
        const currentState = await pollForJobListProgress(
            page,
            beforeClickRawCount,
            beforeClickCount,
            signal,
        );
        const rawCountChanged =
            currentState.rawCount !== beforeClickRawCount;
        const uniqueCountChanged =
            currentState.uniqueCount !== beforeClickCount;

        if (!uniqueCountChanged && !rawCountChanged) {
            stableClicks += 1;
            if (stableClicks >= stableClicksToStop) break;
        } else {
            stableClicks = 0;
            if (uniqueCountChanged) {
                onProgress?.({
                    type: 'jobs:loading',
                    count: currentState.uniqueCount,
                });
            }
        }
        previousRawCount = currentState.rawCount;
        previousUniqueCount = currentState.uniqueCount;
    }
}
