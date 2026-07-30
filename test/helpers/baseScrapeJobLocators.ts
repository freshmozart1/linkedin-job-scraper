import {
    OVERLAY_SELECTOR,
    COMPANY_SELECTOR,
    DESCRIPTION_SELECTOR,
    JOB_CRITERIA_VALUE_SELECTOR,
} from '../../src';
import { createFakeLocator } from './fakePlaywright';

/** Locators shared by every scrapeJob() test: no overlay ever appears, and the detail-pane title link is always found. */
export function baseScrapeJobLocators(
    detailCompany: () => string | null,
    description = 'A description.',
    tags: string[] = ['Full-time'],
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
    };
}
