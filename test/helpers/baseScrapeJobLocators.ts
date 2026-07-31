import {
    OVERLAY_SELECTOR,
    COMPANY_SELECTOR,
    DESCRIPTION_SELECTOR,
    DETAIL_TITLE_LINK_SELECTOR,
    JOB_CRITERIA_VALUE_SELECTOR,
} from '../../src';
import { createFakeLocator } from './fakePlaywright';

/**
 * Locators shared by every scrapeJob() test: no overlay ever appears, and
 * the detail-pane title link is always found. When `sourceJobId` is passed,
 * the detail-pane title link's href is also registered to reference that
 * same job — a non-stale pane — so `sourceJobIdMismatch` stays false.
 * Omitted, the href stays unconfigured (null), which also leaves
 * `sourceJobIdMismatch` false via its own fail-open null-guard.
 */
export function baseScrapeJobLocators(
    detailCompany: () => string | null,
    description = 'A description.',
    tags: string[] = ['Full-time'],
    sourceJobId: string | null = null,
) {
    return {
        [OVERLAY_SELECTOR]: createFakeLocator({ isVisible: () => false }),
        [COMPANY_SELECTOR]: createFakeLocator({
            innerText: () => {
                const company = detailCompany();
                if (company === null)
                    throw new Error('no detail company element');
                return company;
            },
        }),
        [DESCRIPTION_SELECTOR]: createFakeLocator({
            innerText: () => description,
        }),
        [JOB_CRITERIA_VALUE_SELECTOR]: createFakeLocator({
            allInnerTexts: () => tags,
        }),
        ...(sourceJobId
            ? {
                  [DETAIL_TITLE_LINK_SELECTOR]: createFakeLocator({
                      getAttribute: () =>
                          `https://de.linkedin.com/jobs/view/some-job-${sourceJobId}`,
                  }),
              }
            : {}),
    };
}
