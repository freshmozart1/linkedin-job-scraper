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
//
// LinkedIn's own lazy-load listener only reacts to genuine incremental
// scroll progress — a single `scrollTo(0, document.body.scrollHeight)` jump
// never triggers it, which used to cap every run at the ~60 jobs LinkedIn
// pre-renders on initial load (GitHub issue #10). The fix scrolls one <li>
// at a time instead (scrollNewlyRenderedListItems/scrollToListItem below),
// pausing briefly between each so the browser actually dispatches a scroll
// event per step rather than coalescing them into one.
// hidePageSectionsAboveJobList hides the header/filters/alerts LinkedIn
// renders above the list, once, up front, so each <li>'s own rendered
// height is exactly the pixel distance needed to bring the next one into
// the same viewport position — with that content still occupying space, a
// <li>'s height wouldn't match how far the viewport actually has to move.
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

// LinkedIn DOM sections that render above the job list — hidden once so
// each rendered <li>'s height exactly equals the scroll distance to the
// next one (see the file's top comment). Single-use and purely cosmetic —
// unlike JOB_LIST_SELECTOR, these aren't promoted to ../selectors. Passed
// as an explicit page.evaluate() argument rather than hardcoded inline:
// page.evaluate can't close over module state, but an explicit arg is
// JSON-serialized, not a closure, so this sidesteps that restriction
// without duplicating a six-string array inline.
const SECTIONS_ABOVE_JOB_LIST_SELECTORS = [
    '#artdeco-global-alert-container',
    'div.artdeco-global-alert.artdeco-global-alert--NOTICE.artdeco-global-alert--COOKIE_CONSENT',
    // No trailing `.show`: LinkedIn only adds that class (and switches this
    // header to `position: sticky`, pinned at the viewport top) once the
    // user has already scrolled past its natural position. Since this runs
    // once up front, before any scrolling, matching on `.show` would always
    // miss it — confirmed live (see CLAUDE.md's Testing section) that the
    // header exists and takes up space pre-scroll without that class, and
    // that hiding it here still holds once LinkedIn's own JS adds `.show`
    // later, since the inline `display: none` set below isn't undone by a
    // class toggle.
    'header.base-serp-page__header.global-alert-offset.sticky-header',
    'section.base-serp-page__filters-bar',
    'section.two-pane-serp-page__search-header',
    'div.results-context-header',
];

async function hidePageSectionsAboveJobList(page: Page): Promise<void> {
    // Runs in the browser context; this package compiles without the DOM
    // lib, so the browser globals are named through a structural cast.
    await page.evaluate((selectors) => {
        interface MinimalStyledElement {
            style: { display: string; marginTop: string };
        }
        const g = globalThis as unknown as {
            document: {
                querySelector(selector: string): MinimalStyledElement | null;
            };
        };
        for (const selector of selectors) {
            const el = g.document.querySelector(selector);
            if (el) el.style.display = 'none';
        }
        const main = g.document.querySelector('#main-content');
        if (main) main.style.marginTop = '0';
    }, SECTIONS_ABOVE_JOB_LIST_SELECTORS);
}

// LinkedIn's own automatic infinite scroll caps out around 120 items before
// switching to the manual "See more jobs" button (see the file's top
// comment) — this bound is a defensive backstop against an unbounded loop,
// the same way pollForNewJobs (./pollForNewJobs) caps its own poll count,
// and should never actually be reached in practice.
const MAX_LIST_ITEMS_PER_SCROLL_PASS = 200;

// Scrolls exactly one <li> at a time — never a single instant jump —
// because LinkedIn's lazy-load listener only reacts to genuine incremental
// scroll progress (see the file's top comment). Re-checks the live <li> at
// each index rather than reading the list's length once, since LinkedIn
// appends more <li>s to the same <ul> once scrolled past whatever was
// rendered initially — that's also why this resumes from `fromIndex`
// instead of restarting at 0 every phase iteration. Returns the index of
// the first <li> not found, i.e. how many were scrolled through this call.
async function scrollNewlyRenderedListItems(
    page: Page,
    fromIndex: number,
): Promise<number> {
    let index = fromIndex;
    for (
        let scrolled = 0;
        scrolled < MAX_LIST_ITEMS_PER_SCROLL_PASS;
        scrolled++
    ) {
        const height = await scrollToListItem(page, index);
        if (height === null) break;
        index += 1;
        await sleep(120);
    }
    return index;
}

// Runs in the browser context; this package compiles without the DOM lib,
// so the browser globals are named through a structural cast. The <li>
// index is passed as an explicit evaluate() argument (JSON-serialized, not
// a closure) rather than read from a closed-over variable, which
// page.evaluate() can't do (see collectJobIds.ts). Returns null on element
// *absence*, never on a zero rendered height — a real <li> (e.g. a
// separator/ad card) can legitimately have zero height, and that must not
// be mistaken for "past the end of the list".
async function scrollToListItem(
    page: Page,
    index: number,
): Promise<number | null> {
    return page.evaluate((i) => {
        interface MinimalListItemElement {
            getBoundingClientRect(): { height: number };
        }
        const g = globalThis as unknown as {
            document: {
                querySelectorAll(
                    selector: string,
                ): ArrayLike<MinimalListItemElement>;
            };
            scrollBy(x: number, y: number): void;
        };
        // Hardcoded literally (page.evaluate can't close over selectors.ts)
        // — keep in sync with JOB_LIST_SELECTOR there.
        const li = g.document.querySelectorAll(
            'ul.jobs-search__results-list > li',
        )[i];
        if (!li) return null;
        const height = li.getBoundingClientRect().height;
        g.scrollBy(0, height);
        return height;
    }, index);
}
