import type { Page, Locator } from 'playwright';
import { JOB_LIST_SELECTOR } from '../selectors';

// Scoped to `ul.jobs-search__results-list` rather than a generic `main ul`
// so this can never accidentally match LinkedIn's separate
// `ul.similar-titles__list` ("Related searches") elsewhere on the page. The
// h3-filter is defense-in-depth on top of that scoping: LinkedIn's guest job
// list can still append a handful of trailing, non-job `<li>`s after the real
// cards (no title, clicking them doesn't change the detail pane), and scoping
// to items that actually contain a title heading keeps the counted total and
// the indexed element in sync, so the scrape loop never runs past the real
// list.
export function jobItemsLocator(page: Page): Locator {
    return page.locator(JOB_LIST_SELECTOR).filter({ has: page.locator('h3') });
}
