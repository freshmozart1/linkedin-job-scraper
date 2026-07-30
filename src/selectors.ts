// CSS selectors LinkedIn's guest job-search page markup is scraped through.
// Exported so consumers (and this package's own tests) don't have to
// hand-duplicate these strings.
//
// JOB_LIST_SELECTOR is also hardcoded literally inside collectJobIds()'s
// page.evaluate() in scraper/collectJobIds.ts (page.evaluate serializes the
// callback via toString(), so it can't close over this module's exports) —
// keep both in sync if this ever changes.
export const JOB_LIST_SELECTOR = 'ul.jobs-search__results-list > li';
export const SEE_MORE_BUTTON_SELECTOR =
    'button.infinite-scroller__show-more-button';
export const VIEWED_ALL_JOBS_SELECTOR = '.see-more-jobs__viewed-all';
export const LIST_COMPANY_SELECTOR = 'h4.base-search-card__subtitle';
export const COMPANY_SELECTOR = '.topcard__org-name-link';
export const DESCRIPTION_SELECTOR = '.description__text';
export const OVERLAY_SELECTOR = '.modal__overlay--visible';
export const JOB_LINK_SELECTOR = '.base-card__full-link';
/** The company-page link nested inside the list item's company subtitle. */
export const LIST_COMPANY_LINK_SELECTOR = 'h4.base-search-card__subtitle a';
/** The list card's single location span. Exactly one per job card. */
export const LIST_LOCATION_SELECTOR = 'span.job-search-card__location';
/** The list card's posting-date `<time>` element; its `datetime` attribute (not the relative display text) is what's read. */
export const LIST_POSTED_AT_SELECTOR = 'time.job-search-card__listdate';

// Job detail pane ("job criteria" / tags).
/** Each value span inside the detail pane's job-criteria list (seniority level, employment type, job function, industries). Labels are not scraped, only values. */
export const JOB_CRITERIA_VALUE_SELECTOR =
    '.description__job-criteria-text--criteria';

// Company page ("Locations" section). COMPANY_LOCATION_ITEM_SELECTOR and
// COMPANY_PRIMARY_TAG_SELECTOR are also hardcoded literally inside
// readRawLocations()'s page.evaluate() in companyLookup.ts, for the same
// reason collectJobIds() duplicates JOB_LIST_SELECTOR — keep both copies in
// sync if these ever change.
export const COMPANY_LOCATIONS_SECTION_SELECTOR = 'section.locations';
export const COMPANY_LOCATION_ITEM_SELECTOR = 'section.locations li';
/**
 * The tag LinkedIn renders inside exactly one location `<li>` to mark the
 * company's primary address. Matched on presence, not on its "Primary" text,
 * which is subject to localization.
 */
export const COMPANY_PRIMARY_TAG_SELECTOR = '.tag-sm';
