import type { Page, Locator } from 'playwright';
import type { ScrapeProgressEvent } from '../types';
import { collectJobIds } from './collectJobIds';
import { sleep } from './sleep';
import { hidePageSectionsAboveJobList } from './hidePageSectionsAboveJobList';
import { scrollNewlyRenderedListItems } from './scrollNewlyRenderedListItems';

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
//
// LinkedIn's own lazy-load listener only reacts to genuine incremental
// scroll progress — a single `scrollTo(0, document.body.scrollHeight)` jump
// never triggers it, which used to cap every run at the ~60 jobs LinkedIn
// pre-renders on initial load (GitHub issue #10). The fix scrolls one <li>
// at a time instead (scrollNewlyRenderedListItems/scrollToListItem, in
// their own sibling files), pausing briefly between each so the browser
// actually dispatches a scroll event per step rather than coalescing them
// into one.
// hidePageSectionsAboveJobList hides the header/filters/alerts LinkedIn
// renders above the list, once, up front, so each <li>'s own rendered
// height is exactly the pixel distance needed to bring the next one into
// the same viewport position — with that content still occupying space, a
// <li>'s height wouldn't match how far the viewport actually has to move.
//
// CRAP score here is driven by fallow's *estimated* (not instrumented)
// coverage defaulting to 0% for this function, not an actual
// untested-complexity risk — verified via `fallow check_health`; the 5
// scrollLoadPhase tests in test/scrollLoadPhase.test.ts already exercise
// every branch below.
// fallow-ignore-next-line complexity
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
    let scrolledListItemCount = 0;

    await hidePageSectionsAboveJobList(page);

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

        const nextScrolledListItemCount = await scrollNewlyRenderedListItems(
            page,
            scrolledListItemCount,
        );
        if (nextScrolledListItemCount === scrolledListItemCount) {
            // Nothing currently rendered was left to scroll through — give
            // LinkedIn a moment to append the next batch before re-reading
            // the unique count, same as the old single-jump's fixed pause.
            await sleep(800);
        } else {
            scrolledListItemCount = nextScrolledListItemCount;
        }
    }

    return previousUniqueCount;
}
