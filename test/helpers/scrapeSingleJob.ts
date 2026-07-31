import { stubCompanyLookup } from './stubCompanyLookup';
import { createFakeLocator, createFakePage } from './fakePlaywright';
import { scrapeJob, JOB_LIST_SELECTOR, CompanyLookup } from '../../src';
import type { JobResult } from '../../src';
import { baseScrapeJobLocators } from './baseScrapeJobLocators';
import { Locator } from 'playwright';

/** Runs scrapeJob against one job card on an otherwise clean page (no overlay, detail pane resolves). */
export async function scrapeSingleJob(
    jobItem: Locator,
    pageUrl?: string,
    companyLookup?: CompanyLookup,
): Promise<JobResult> {
    const page = createFakePage({
        url: pageUrl ? () => pageUrl : undefined,
        locatorsBySelector: {
            [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
            ...baseScrapeJobLocators(() => 'Acme'),
        },
        defaultLocator: createFakeLocator({
            waitFor: () => {},
            isVisible: () => false,
        }),
    });
    return scrapeJob(page, 0, {
        seenSourceJobIds: new Map(),
        runTimestamp: 123,
        companyLookup: companyLookup ?? stubCompanyLookup(),
    });
}
