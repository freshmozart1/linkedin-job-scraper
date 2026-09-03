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
import { buildSkippedResult } from './buildSkippedResult';
import { sleep } from './sleep';
import { clickWithOverlayRetries } from './clickWithOverlayRetries';
import type { OverlayClearSettings } from './clearBlockingOverlays';
import { dismissOverlayAfterClick } from './dismissOverlayAfterClick';
import { waitForJobDetailToLoad } from './waitForJobDetailToLoad';
import { readJobDetailPane } from './readJobDetailPane';
import { trim } from './trim';
import { createJobBudget } from './jobBudget';

export interface ScrapeJobOptions {
    preClickDelayMs?: number;
    seenSourceJobIds: Map<string, number>;
    runTimestamp: number;
    clickRetryAttempts?: number;
    companyLookup: CompanyLookup;
    shouldScrapeJob?: ShouldScrapeJob;
    /**
     * Passed straight through to the three overlay helpers below, which are
     * otherwise the only part of a job's scrape with no route back to the
     * run's progress stream — nor to the caller's `ScraperOptions.overlayClear`
     * tier policy, which would otherwise apply only to the single clear
     * `runScrape` does after `page.goto`. Nothing here emits a job-level event
     * of its own — that stays scrapeJobAndRecord's job.
     */
    overlayClear?: OverlayClearSettings;
    /**
     * Wall-clock budget for this one job; see `ScraperOptions.perJobTimeoutMs`
     * for the default and for what a job that blows it comes back as.
     */
    perJobTimeoutMs?: number;
    /**
     * The run's (already composed) abort signal. Threaded down to the same
     * budget as `perJobTimeoutMs` so an abort lands inside a slow job within
     * seconds, instead of only being noticed between jobs — which used to
     * mean waiting out the full ~100s a stuck job could take.
     */
    signal?: AbortSignal;
}

export async function scrapeJob(
    page: Page,
    index: number,
    options: ScrapeJobOptions,
): Promise<JobResult> {
    const jobItem = jobItemsLocator(page).nth(index);
    // One budget for this job, created before the first wait so it measures
    // the job's whole scrape, and threaded through every wait below so it
    // bounds real elapsed time rather than only being checked between steps.
    const budget = createJobBudget({
        perJobTimeoutMs: options.perJobTimeoutMs,
        signal: options.signal,
    });
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
        budget.check();
        // Explicitly bounded: with no `timeout` this silently inherits
        // Playwright's 30s default (nothing calls setDefaultTimeout), which
        // was a third of a stuck job's worst case on its own. A card that
        // won't scroll into view in 5s is not going to click either.
        await jobItem.scrollIntoViewIfNeeded({
            timeout: budget.boundedTimeout(5000),
        });
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
        budget.check();
        await readJobListIdentity(jobItem, page, identity, budget);
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
            return buildSkippedResult(
                index,
                cardIdentity,
                options.seenSourceJobIds,
            );
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

        budget.check();
        await clickWithOverlayRetries(jobItem, page, {
            maxAttempts: options.clickRetryAttempts,
            overlayClear: options.overlayClear,
            budget,
        });
        budget.check();
        await dismissOverlayAfterClick(page, options.overlayClear, budget);
        budget.check();
        await waitForJobDetailToLoad(page, sourceJobId, budget);
        budget.check();
        const {
            company,
            descriptionText,
            companyMismatch,
            sourceJobIdMismatch,
            lateOverlayDetected,
        } = await readJobDetailPane(
            jobItem,
            page,
            sourceJobId,
            options.overlayClear,
            budget,
        );

        // Deliberately after readJobDetailPane's checkForLateOverlay: that check
        // has to stay tight against the company/description reads it validates,
        // and this lookup can take seconds. Run in between, it would make
        // lateOverlayDetected describe a moment well after the data it's
        // supposed to vouch for.
        //
        // The lookup drives its own page on its own context, so it can't disturb
        // this page or its detail pane, and it never rejects — a company page
        // that's blocked or missing yields null instead of failing the job.
        budget.check();
        const companyAddresses = await options.companyLookup.addressesFor(
            companyUrl,
            budget,
        );
        budget.check();
        const tags = await trim<string[] | null>(
            jobItem,
            JOB_CRITERIA_VALUE_SELECTOR,
            { page, budget },
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
        // Also where a blown budget and a mid-job abort land: both arrive as
        // ordinary Errors from budget.check(), so a timed-out or aborted job
        // still reports whatever identity was captured before it stopped
        // rather than vanishing, and still emits the usual job:done upstream.
        // For an abort that means the in-flight job keeps an honest slot in
        // ScrapeAbortedError's `partial.results`.
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
