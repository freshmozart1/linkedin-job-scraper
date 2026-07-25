// CSS selectors LinkedIn's guest job-search page markup is scraped through.
// Exported so consumers (and this package's own tests) don't have to
// hand-duplicate these strings.
//
// JOB_LIST_SELECTOR is also hardcoded literally inside collectJobIds()'s
// page.evaluate() in scraper.ts (page.evaluate serializes the callback via
// toString(), so it can't close over this module's exports) — keep both in
// sync if this ever changes.
export const JOB_LIST_SELECTOR = 'ul.jobs-search__results-list > li';
export const SEE_MORE_BUTTON_SELECTOR = 'button.infinite-scroller__show-more-button';
export const VIEWED_ALL_JOBS_SELECTOR = '.see-more-jobs__viewed-all';
export const LIST_COMPANY_SELECTOR = 'h4.base-search-card__subtitle';
export const COMPANY_SELECTOR = '.topcard__org-name-link';
export const DESCRIPTION_SELECTOR = '.description__text';
export const OVERLAY_SELECTOR = '.modal__overlay--visible';
export const JOB_LINK_SELECTOR = '.base-card__full-link';
