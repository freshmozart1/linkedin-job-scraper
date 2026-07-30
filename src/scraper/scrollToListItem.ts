import type { Page } from 'playwright';

export interface ScrollToListItemResult {
    /** The scrolled <li>'s own height, or null if `index` doesn't exist. */
    height: number | null;
    /** Number of <li>s currently rendered in the list (read in the same pass). */
    renderedCount: number;
}

// Runs in the browser context; this package compiles without the DOM lib,
// so the browser globals are named through a structural cast. The <li>
// index is passed as an explicit evaluate() argument (JSON-serialized, not
// a closure) rather than read from a closed-over variable, which
// page.evaluate() can't do (see collectJobIds.ts). `height` is null on
// element *absence*, never on a zero rendered height — a real <li> (e.g. a
// separator/ad card) can legitimately have zero height, and that must not
// be mistaken for "past the end of the list". `renderedCount` is the live
// list length read in the same evaluate() call — scrollNewlyRenderedListItems
// uses it to tell "nothing new rendered yet" apart from "the list actually
// shrank below our resume point" (LinkedIn re-serving a shorter page).
//
// Hardcoded literally (page.evaluate can't close over selectors.ts) — keep
// in sync with JOB_LIST_SELECTOR in ../selectors, and collectJobIds.ts.
export async function scrollToListItem(
    page: Page,
    index: number,
): Promise<ScrollToListItemResult> {
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
        const list = g.document.querySelectorAll(
            'ul.jobs-search__results-list > li',
        );
        const li = list[i];
        if (!li) return { height: null, renderedCount: list.length };
        const height = li.getBoundingClientRect().height;
        g.scrollBy(0, height);
        return { height, renderedCount: list.length };
    }, index);
}
