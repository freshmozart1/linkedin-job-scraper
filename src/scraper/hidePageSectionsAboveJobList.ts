import type { Page } from 'playwright';

// LinkedIn DOM sections that render above the job list — hidden once so
// each rendered <li>'s height exactly equals the scroll distance to the
// next one (see scrollLoadPhase.ts's top comment). Single-use and purely
// cosmetic — unlike JOB_LIST_SELECTOR, these aren't promoted to
// ../selectors. Passed as an explicit page.evaluate() argument rather than
// hardcoded inline: page.evaluate can't close over module state, but an
// explicit arg is JSON-serialized, not a closure, so this sidesteps that
// restriction without duplicating a six-string array inline.
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

export async function hidePageSectionsAboveJobList(page: Page): Promise<void> {
    // Runs in the browser context; this package compiles without the DOM
    // lib, so the browser globals are named through a structural cast (see
    // collectJobIds.ts).
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
