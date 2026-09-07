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
 * the detail-pane title link is always found. The title-link href defaults to
 * job `111`, matching the fixture default; pass a value or callback to model
 * a different, delayed, or persistently stale pane.
 */
export function baseScrapeJobLocators(
    detailCompany: () => string | null,
    description = 'A description.',
    tags: string[] = ['Full-time'],
    sourceJobId: string | null | (() => string | null) = '111',
) {
    const currentSourceJobId = () =>
        typeof sourceJobId === 'function' ? sourceJobId() : sourceJobId;
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
        [DETAIL_TITLE_LINK_SELECTOR]: createFakeLocator({
            getAttribute: () => {
                const jobId = currentSourceJobId();
                return jobId
                    ? `https://de.linkedin.com/jobs/view/some-job-${jobId}`
                    : null;
            },
        }),
    };
}
