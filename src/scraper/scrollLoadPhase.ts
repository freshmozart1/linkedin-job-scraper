import type { Page, Locator } from 'playwright';
import type { ScrapeProgressEvent } from '../types';
import { collectJobIds } from './collectJobIds';
import { sleep } from './sleep';

export interface ScrollLoadPhaseOptions {
    maxScrollAttempts?: number;
    stableScrollsToStop?: number;
    onProgress?: (event: ScrapeProgressEvent) => void;
}

// Phase A: LinkedIn's own scroll-triggered infinite scroll, which loads jobs
// in batches of 10 automatically until the list reaches 120 items — at that
// point LinkedIn hides this behavior behind a manual "See more jobs" button
// instead (handled by clickLoadPhase, Phase B), so stop scrolling the moment
// that button appears rather than waiting for scroll growth to go stable on
// its own (it can appear before that happens). Returns the unique job count
// once scrolling stops, as the starting point for Phase B.
export async function scrollLoadPhase(
    page: Page,
    seeMoreButton: Locator,
    options: ScrollLoadPhaseOptions = {},
): Promise<number> {
    const {
        maxScrollAttempts = 60,
        stableScrollsToStop = 3,
        onProgress,
    } = options;
    let previousUniqueCount = 0;
    let stableReads = 0;

    for (let attempt = 0; attempt < maxScrollAttempts; attempt++) {
        const currentUniqueCount = (await collectJobIds(page)).size;

        if (currentUniqueCount === previousUniqueCount) {
            stableReads += 1;
            if (stableReads >= stableScrollsToStop) break;
        } else {
            stableReads = 0;
            onProgress?.({ type: 'jobs:loading', count: currentUniqueCount });
        }

        previousUniqueCount = currentUniqueCount;

        if (await seeMoreButton.isVisible().catch(() => false)) break;

        // Runs in the browser context; this package compiles without the DOM
        // lib, so the browser globals are named through a structural cast.
        await page.evaluate(() => {
            const g = globalThis as unknown as {
                scrollTo(x: number, y: number): void;
                document: { body: { scrollHeight: number } };
            };
            g.scrollTo(0, g.document.body.scrollHeight);
        });
        await sleep(800);
    }

    return previousUniqueCount;
}
