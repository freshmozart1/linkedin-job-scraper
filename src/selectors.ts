// CSS selectors LinkedIn's guest job-search page markup is scraped through.
// Exported so consumers (and this package's own tests) don't have to
// hand-duplicate these strings.
//
// JOB_LIST_SELECTOR is also hardcoded literally inside collectJobIds()'s and
// scrollToListItem()'s page.evaluate() calls (scraper/collectJobIds.ts and
// scraper/scrollToListItem.ts — page.evaluate serializes the callback via
// toString(), so it can't close over this module's exports) — keep all
// three copies in sync if this ever changes.
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
/**
 * The list card's posting-date `<time>` element; its `datetime` attribute
 * (not the relative display text) is what's read. LinkedIn renders a
 * `--new` class variant on this element for very recently posted jobs
 * (confirmed live: every job on an `f_TPR=r86400` search carries only
 * `job-search-card__listdate--new`, while older/newer postings coexist on
 * a mixed-age page under either class) — match both so recent postings
 * don't fail with "No posted date found for list item" (GitHub issue #15).
 */
export const LIST_POSTED_AT_SELECTOR =
    'time.job-search-card__listdate, time.job-search-card__listdate--new';

// Job detail pane ("job criteria" / tags).
/** Each value span inside the detail pane's job-criteria list (seniority level, employment type, job function, industries). Labels are not scraped, only values. */
export const JOB_CRITERIA_VALUE_SELECTOR =
    '.description__job-criteria-text--criteria';
/**
 * The detail pane's own title link. Its `href` is the canonical URL of
 * whichever posting is currently rendered in the pane — including that
 * posting's own job ID — independent of the company text, which is what
 * lets a pane left over from an earlier posting at the *same* company still
 * be caught (confirmed live: two different postings from one company each
 * render this href with their own distinct job ID). `waitForJobDetailToLoad`
 * appends its own `[href*="-<jobId>"]` filter onto this same base selector
 * rather than duplicating the `topcard-title` string.
 */
export const DETAIL_TITLE_LINK_SELECTOR = 'a[href*="topcard-title"]';

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

// Overlay dismissal (see scraper/clearBlockingOverlays.ts).
/**
 * Every clickable control inside an overlay, in DOM order. Deliberately
 * broader than `button` alone: an interstitial's close control is often an
 * `[role="button"]` icon span rather than a real `<button>`, and missing it
 * is exactly the "nothing was ever clicked" failure GitHub issue #27
 * describes.
 *
 * This same string is handed to `readOverlayDiagnostics`'s `page.evaluate`
 * as an explicit argument, so the `buttonNames[i]` it reports lines up
 * index-for-index with `overlay.locator(OVERLAY_BUTTON_SELECTOR).nth(i)`.
 * That alignment is load-bearing: `pickDismissButtonIndex` chooses an index
 * off the names, and the click is then aimed by that same index.
 */
export const OVERLAY_BUTTON_SELECTOR = 'button, [role="button"]';
/**
 * Accessible names that identify an overlay control as a *dismiss* control.
 *
 * Widened well past the original `/reject|dismiss|accept/i` (GitHub issue
 * #27): a sign-in / "join LinkedIn" interstitial's close control is
 * commonly named `Close`, `Schließen`, `×` or `Zurück`, none of which the
 * old pattern matched — so nothing was ever clicked and the caller burned
 * its entire retry budget against an overlay that was still there.
 *
 * The word alternatives carry only a *leading* `\b`, not a trailing one, so
 * `Dismissed` / `Accept all` still match the way the original substring
 * pattern did, while `Feedback` no longer matches on `back`. The `×`-family
 * glyphs are matched bare: an icon-only close control frequently has no
 * name other than the multiplication sign itself, and `\b` (ASCII-word
 * based) doesn't behave usefully around non-ASCII characters.
 */
export const OVERLAY_DISMISS_NAME_PATTERN =
    /\b(?:reject|dismiss|accept|close|back|no thanks|not now|skip|ablehnen|akzeptieren|zustimmen|verwerfen|zur(?:ü|ue)ck|sp(?:ä|ae)ter|schlie(?:ß|ss)en)|[×✕✖⨯]/i;
/**
 * Accessible names that identify an overlay control as one that would
 * navigate the scrape *off* the search page. This is the reason
 * `pickDismissButtonIndex` does not simply "fall back to any button inside
 * the overlay": blind-clicking inside a sign-in interstitial otherwise hits
 * *Sign in* / *Join now* and loses the job list for the rest of the run —
 * a strictly worse outcome than the stuck overlay this all exists to fix.
 */
export const OVERLAY_SIGN_IN_NAME_PATTERN =
    /\b(?:sign\s*-?\s*(?:in|up)|log\s*-?\s*in|login|join|register|apply|continue with|anmelden|einloggen|registrieren|bewerben)/i;
