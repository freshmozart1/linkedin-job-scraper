import type { Page, Locator } from 'playwright';
import type { ScrapeProgressEvent } from '../types';
import { VIEWED_ALL_JOBS_SELECTOR } from '../selectors';
import { clickWithOverlayRetries } from './clickWithOverlayRetries';
import { pollForNewJobs } from './pollForNewJobs';

export interface ClickLoadPhaseOptions {
    maxSeeMoreClicks?: number;
    stableClicksToStop?: number;
    clickRetryAttempts?: number;
    onProgress?: (event: ScrapeProgressEvent) => void;
}

// Phase B: past 120 items LinkedIn requires clicking "See more jobs" for
// each further batch of 10 instead of auto-loading on scroll. Click through
// clickWithOverlayRetries() (./clickWithOverlayRetries) since the sign-in
// nag can reappear here too, and stop once LinkedIn's own "You've viewed
// all jobs for this search" banner appears, the button itself goes away, or
// growth stalls for several consecutive clicks (the same stale/repeated-page
// risk collectJobIds() already guards against in Phase A,
// ./scrollLoadPhase).
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
    } = options;
    const viewedAllBanner = page.locator(VIEWED_ALL_JOBS_SELECTOR);
    let stableClicks = 0;
    let previousUniqueCount = initialUniqueCount;

    for (let attempt = 0; attempt < maxSeeMoreClicks; attempt++) {
        if (await viewedAllBanner.isVisible().catch(() => false)) break;
        if (!(await seeMoreButton.isVisible().catch(() => false))) break;

        const beforeClickCount = previousUniqueCount;
        await clickWithOverlayRetries(seeMoreButton, page, clickRetryAttempts);
        const currentUniqueCount = await pollForNewJobs(page, beforeClickCount);

        if (currentUniqueCount === beforeClickCount) {
            stableClicks += 1;
            if (stableClicks >= stableClicksToStop) break;
        } else {
            stableClicks = 0;
            onProgress?.({ type: 'jobs:loading', count: currentUniqueCount });
        }
        previousUniqueCount = currentUniqueCount;
    }
}
