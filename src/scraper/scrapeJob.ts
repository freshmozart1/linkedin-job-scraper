import type { Page } from 'playwright';
import type { JobCardIdentity, JobResult, ShouldScrapeJob } from '../types';
import type { CompanyLookup } from '../companyLookup';
import { JOB_CRITERIA_VALUE_SELECTOR } from '../selectors';
import { jobItemsLocator } from './jobItemsLocator';
import {
    readJobListIdentity,
    type JobListIdentity,
} from './readJobListIdentity';
import { registerJobOccurrence } from './registerJobOccurrence';
import { sleep } from './sleep';
import { clickWithOverlayRetries } from './clickWithOverlayRetries';
import { dismissOverlayAfterClick } from './dismissOverlayAfterClick';
import { waitForJobDetailToLoad } from './waitForJobDetailToLoad';
import { readJobDetailPane } from './readJobDetailPane';
import { trim } from './trim';

export interface ScrapeJobOptions {
    preClickDelayMs?: number;
    seenSourceJobIds: Map<string, number>;
    runTimestamp: number;
    clickRetryAttempts?: number;
    companyLookup: CompanyLookup;
    shouldScrapeJob?: ShouldScrapeJob;
}

export async function scrapeJob(
    page: Page,
    index: number,
    options: ScrapeJobOptions,
): Promise<JobResult> {
    const jobItem = jobItemsLocator(page).nth(index);
    // Hoisted so the catch below can return whatever identity was captured
    // before a later failure, instead of losing it along with the rest of
    // the job.
    const identity: JobListIdentity = {
        title: null,
        sourceUrl: null,
        sourceHostname: null,
        sourceJobId: null,
        companyUrl: null,
        location: null,
        postedAt: null,
    };
    // Hoisted so the catch return keeps the marker when a duplicate's scrape
    // fails partway through.
    let duplicateOfIdx: number | null = null;
    try {
        await jobItem.scrollIntoViewIfNeeded();
        // Belt-and-suspenders: jobItemsLocator() already excludes `<li>`s
        // without an `<h3>`, but if LinkedIn's markup shifts and a non-job
        // item slips through anyway, don't click it and fabricate a
        // "success" record for it — bail out before touching the page at
        // all.
        const firstH3 = jobItem.locator('h3').first();
        if ((await firstH3.count()) === 0)
            throw new Error(
                'No job title found for this list item - LinkedIn markup has likely changed',
            );
        await readJobListIdentity(jobItem, page, identity);
        // readJobListIdentity only returns without throwing once every field on
        // `identity` is populated, so these are safe to assert non-null here.
        const title = identity.title as string;
        const sourceUrl = identity.sourceUrl as string;
        const sourceHostname = identity.sourceHostname as string;
        const sourceJobId = identity.sourceJobId as string;
        const companyUrl = identity.companyUrl as string;
        const location = identity.location as string;
        const postedAt = identity.postedAt as string;

        const cardIdentity: JobCardIdentity = {
            title,
            sourceUrl,
            sourceHostname,
            sourceJobId,
            companyUrl,
            location,
            postedAt,
        };

        if (options.shouldScrapeJob && !options.shouldScrapeJob(cardIdentity)) {
            // Not registered via registerJobOccurrence — a skipped job never
            // becomes the map's "first occurrence" for later duplicates to
            // point at (see the skip-branch test coverage). But if an
            // *earlier* list index already registered this sourceJobId (this
            // posting was scraped in full elsewhere in the run before this
            // occurrence was filtered out), that's a real duplicate and
            // duplicateOfIdx must say so — not doing so would violate the
            // field's own contract ("index of the earlier job in this run
            // with the same posting ID; null when not a duplicate"). Guarded
            // against self-reference the same way registerJobOccurrence is,
            // in case this exact index was already registered on an earlier
            // pass (a stale retry re-evaluating shouldScrapeJob for itself).
            const firstSeenIndex = options.seenSourceJobIds.get(sourceJobId);
            return {
                index,
                status: 'skipped',
                ...cardIdentity,
                company: null,
                descriptionText: null,
                companyMismatch: false,
                sourceJobIdMismatch: false,
                lateOverlayDetected: false,
                scrapedAt: new Date().toISOString(),
                duplicateOfIdx:
                    firstSeenIndex === undefined || firstSeenIndex === index
                        ? null
                        : firstSeenIndex,
                companyAddresses: null,
                tags: null,
            };
        }

        // Duplicates (repeated pages from LinkedIn's list-loading pagination) are
        // scraped in full like any other job — they're only marked, so the
        // caller can hide or show them.
        duplicateOfIdx = registerJobOccurrence(
            options.seenSourceJobIds,
            sourceJobId,
            index,
        );

        if (options.preClickDelayMs) await sleep(options.preClickDelayMs);

        await clickWithOverlayRetries(
            jobItem,
            page,
            options.clickRetryAttempts,
        );
        await dismissOverlayAfterClick(page);
        await waitForJobDetailToLoad(page, sourceJobId);
        const {
            company,
            descriptionText,
            companyMismatch,
            sourceJobIdMismatch,
            lateOverlayDetected,
        } = await readJobDetailPane(jobItem, page, sourceJobId);

        // Deliberately after readJobDetailPane's checkForLateOverlay: that check
        // has to stay tight against the company/description reads it validates,
        // and this lookup can take seconds. Run in between, it would make
        // lateOverlayDetected describe a moment well after the data it's
        // supposed to vouch for.
        //
        // The lookup drives its own page on its own context, so it can't disturb
        // this page or its detail pane, and it never rejects — a company page
        // that's blocked or missing yields null instead of failing the job.
        const companyAddresses =
            await options.companyLookup.addressesFor(companyUrl);
        const tags = await trim<string[] | null>(
            jobItem,
            JOB_CRITERIA_VALUE_SELECTOR,
            { page },
        );
        if (tags === null)
            throw new Error('No job criteria found for job item');
        return {
            index,
            title,
            company,
            descriptionText,
            status: 'success',
            companyMismatch,
            sourceJobIdMismatch,
            lateOverlayDetected,
            sourceJobId,
            sourceUrl,
            sourceHostname,
            scrapedAt: new Date().toISOString(),
            duplicateOfIdx,
            companyUrl,
            companyAddresses,
            location,
            postedAt,
            tags,
        };
    } catch (error) {
        return {
            index,
            title: identity.title,
            company: null,
            descriptionText: null,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            companyMismatch: false,
            sourceJobIdMismatch: false,
            lateOverlayDetected: false,
            sourceJobId: identity.sourceJobId,
            sourceUrl: identity.sourceUrl,
            sourceHostname: identity.sourceHostname,
            scrapedAt: new Date().toISOString(),
            duplicateOfIdx,
            companyUrl: identity.companyUrl,
            companyAddresses: null,
            location: identity.location,
            postedAt: identity.postedAt,
            tags: null,
        };
    }
}
