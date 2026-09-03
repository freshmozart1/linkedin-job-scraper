import { describe, it } from 'node:test';
import { JOB_LIST_SELECTOR, scrapeAllJobsOnce } from '../src';
import type { JobResult, ScrapeProgressEvent } from '../src';
import { createFakeLocator, createFakePage } from './helpers/fakePlaywright';
import { createFakeJobLocator } from './helpers/fakePlaywright/createFakeJobLocator';
import { baseScrapeJobLocators } from './helpers/baseScrapeJobLocators';
import { stubCompanyLookup } from './helpers/stubCompanyLookup';
import { assertFailed } from './helpers/assertFailed';

describe('scrapeAllJobsOnce()', () => {
    it('collects the indices of jobs whose detail-pane company mismatches the list', async ({
        assert,
    }) => {
        let currentDetailCompany = 'Acme';
        const cleanJob = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
            onClick: () => {
                currentDetailCompany = 'Acme';
            },
        });
        const staleJob = createFakeJobLocator({
            title: 'Backend Developer',
            listCompany: 'Acme',
            sourceJobId: '222',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/backend-developer-at-acme-222',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
            onClick: () => {
                currentDetailCompany = 'Globex Corporation';
            },
        });
        const jobLocators = [cleanJob, staleJob];
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({
                    nth: (index) => jobLocators[index]!,
                }),
                ...baseScrapeJobLocators(() => currentDetailCompany),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });

        const staleIndices = await scrapeAllJobsOnce(
            {
                page,
                totalJobs: 2,
                seenSourceJobIds: new Map(),
                runTimestamp: 123,
                delayBetweenJobsMs: 0,
                companyLookup: stubCompanyLookup(),
            },
            [],
        );

        assert.deepEqual(staleIndices, [1]);
    });

    it('emits job:done for a clean result and job:stale for a stale one', async ({
        assert,
    }) => {
        let currentDetailCompany = 'Acme';
        const cleanJob = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
            onClick: () => {
                currentDetailCompany = 'Acme';
            },
        });
        const staleJob = createFakeJobLocator({
            title: 'Backend Developer',
            listCompany: 'Acme',
            sourceJobId: '222',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/backend-developer-at-acme-222',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
            onClick: () => {
                currentDetailCompany = 'Globex Corporation';
            },
        });
        const jobLocators = [cleanJob, staleJob];
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({
                    nth: (index) => jobLocators[index]!,
                }),
                ...baseScrapeJobLocators(() => currentDetailCompany),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });
        const progressEvents: ScrapeProgressEvent[] = [];

        await scrapeAllJobsOnce(
            {
                page,
                totalJobs: 2,
                seenSourceJobIds: new Map(),
                runTimestamp: 123,
                delayBetweenJobsMs: 0,
                companyLookup: stubCompanyLookup(),
                onProgress: (e) => progressEvents.push(e),
            },
            [],
        );

        const doneIndices = progressEvents
            .filter((e) => e.type === 'job:done')
            .map((e) => e.result.index);
        const staleEventIndices = progressEvents
            .filter((e) => e.type === 'job:stale')
            .map((e) => e.result.index);
        assert.deepEqual(doneIndices, [0]);
        assert.deepEqual(staleEventIndices, [1]);
    });

    it('a job that comes back clean on a later pass emits job:done, replacing its earlier job:stale record (retry simulation)', async ({
        assert,
    }) => {
        let currentDetailCompany = 'Globex Corporation'; // mismatched on the first pass
        const jobLocators = [
            createFakeJobLocator({
                title: 'Backend Developer',
                listCompany: 'Acme',
                sourceJobId: '222',
                sourceUrl:
                    'https://www.linkedin.com/jobs/view/backend-developer-at-acme-222',
                companyUrl: 'https://de.linkedin.com/company/acme',
                location: 'Hamburg',
                postedAt: '2026-07-21',
                onClick: () => {}, // detail company left as-is by this click
            }),
        ];
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({
                    nth: (index) => jobLocators[index]!,
                }),
                ...baseScrapeJobLocators(() => currentDetailCompany),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });
        const firstPassEvents: ScrapeProgressEvent[] = [];
        const results: JobResult[] = [];
        const ctx = {
            page,
            totalJobs: 1,
            seenSourceJobIds: new Map<string, number>(),
            runTimestamp: 123,
            delayBetweenJobsMs: 0,
            companyLookup: stubCompanyLookup(),
            onProgress: (e: ScrapeProgressEvent) => firstPassEvents.push(e),
        };

        await scrapeAllJobsOnce(ctx, results);
        assert.deepEqual(
            firstPassEvents
                .filter((e) => e.type === 'job:done' || e.type === 'job:stale')
                .map((e) => e.type),
            ['job:stale'],
        );
        assert.equal(results[0]?.companyMismatch, true);

        // Simulate the retry pass finding the detail pane settled down (clean now).
        currentDetailCompany = 'Acme';
        const secondPassEvents: ScrapeProgressEvent[] = [];
        await scrapeAllJobsOnce(
            { ...ctx, onProgress: (e) => secondPassEvents.push(e) },
            results,
        );

        assert.deepEqual(
            secondPassEvents
                .filter((e) => e.type === 'job:done' || e.type === 'job:stale')
                .map((e) => e.type),
            ['job:done'],
        );
        assert.equal(results[0]?.companyMismatch, false);
    });

    it('a job that is still stale on a later pass emits job:stale again (failed-retry simulation)', async ({
        assert,
    }) => {
        const currentDetailCompany = 'Globex Corporation'; // stays mismatched across both passes
        const jobLocators = [
            createFakeJobLocator({
                title: 'Backend Developer',
                listCompany: 'Acme',
                sourceJobId: '222',
                sourceUrl:
                    'https://www.linkedin.com/jobs/view/backend-developer-at-acme-222',
                companyUrl: 'https://de.linkedin.com/company/acme',
                location: 'Hamburg',
                postedAt: '2026-07-21',
                onClick: () => {},
            }),
        ];
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({
                    nth: (index) => jobLocators[index]!,
                }),
                ...baseScrapeJobLocators(() => currentDetailCompany),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });
        const ctx = {
            page,
            totalJobs: 1,
            seenSourceJobIds: new Map<string, number>(),
            runTimestamp: 123,
            delayBetweenJobsMs: 0,
            companyLookup: stubCompanyLookup(),
        };
        const results: JobResult[] = [];

        const firstPassEvents: ScrapeProgressEvent[] = [];
        await scrapeAllJobsOnce(
            { ...ctx, onProgress: (e) => firstPassEvents.push(e) },
            results,
        );
        const secondPassEvents: ScrapeProgressEvent[] = [];
        await scrapeAllJobsOnce(
            { ...ctx, onProgress: (e) => secondPassEvents.push(e) },
            results,
        );

        assert.deepEqual(
            firstPassEvents
                .filter((e) => e.type === 'job:done' || e.type === 'job:stale')
                .map((e) => e.type),
            ['job:stale'],
        );
        assert.deepEqual(
            secondPassEvents
                .filter((e) => e.type === 'job:done' || e.type === 'job:stale')
                .map((e) => e.type),
            ['job:stale'],
        );
    });

    it('does not abort the run when one job fails partway through — later jobs still get scraped', async ({
        assert,
    }) => {
        const jobLocators = [
            createFakeJobLocator({
                title: 'Frontend Developer',
                listCompany: 'Acme',
                sourceJobId: '111',
                sourceUrl:
                    'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
                companyUrl: 'https://de.linkedin.com/company/acme',
                location: 'Hamburg',
                postedAt: '2026-07-21',
            }),
            createFakeJobLocator({
                title: 'Backend Developer',
                listCompany: 'Acme',
                sourceJobId: '222',
                sourceUrl:
                    'https://www.linkedin.com/jobs/view/backend-developer-at-acme-222',
                companyUrl: 'https://de.linkedin.com/company/acme',
                location: 'Hamburg',
                postedAt: '2026-07-21',
                onClick: () => {
                    throw new Error('click intercepted by another overlay');
                },
            }),
            createFakeJobLocator({
                title: 'Fullstack Developer',
                listCompany: 'Acme',
                sourceJobId: '333',
                sourceUrl:
                    'https://www.linkedin.com/jobs/view/fullstack-developer-at-acme-333',
                companyUrl: 'https://de.linkedin.com/company/acme',
                location: 'Hamburg',
                postedAt: '2026-07-21',
            }),
        ];
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({
                    nth: (index) => jobLocators[index]!,
                }),
                ...baseScrapeJobLocators(() => 'Acme'),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });
        const results: JobResult[] = [];

        await scrapeAllJobsOnce(
            {
                page,
                totalJobs: 3,
                seenSourceJobIds: new Map(),
                runTimestamp: 123,
                delayBetweenJobsMs: 0,
                clickRetryAttempts: 1,
                companyLookup: stubCompanyLookup(),
            },
            results,
        );

        assert.equal(results.length, 3);
        assert.equal(results[0]?.status, 'success');
        const middle = results[1]!;
        assertFailed(middle);
        assert.match(middle.error, /click intercepted by another overlay/);
        assert.equal(results[2]?.status, 'success');
    });

    it('keeps the run going when one job blows its per-job time budget — later jobs still scrape', async ({
        assert,
    }) => {
        // The point of a *per-job* budget rather than a run-level abort
        // (GitHub issue #28): killing the run would throw away every job it
        // had left, so only the job that is actually stuck is sacrificed.
        //
        // Real durations, no mocked clock: a clean job through these fakes
        // spends ~560ms in the overlay-clear polls alone, so 1200ms clears it
        // comfortably while the middle job's 1400ms click cannot fit.
        const jobLocators = [
            createFakeJobLocator({
                title: 'Frontend Developer',
                listCompany: 'Acme',
                sourceJobId: '111',
                sourceUrl:
                    'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
                companyUrl: 'https://de.linkedin.com/company/acme',
                location: 'Hamburg',
                postedAt: '2026-07-21',
            }),
            createFakeJobLocator({
                title: 'Backend Developer',
                listCompany: 'Acme',
                sourceJobId: '222',
                sourceUrl:
                    'https://www.linkedin.com/jobs/view/backend-developer-at-acme-222',
                companyUrl: 'https://de.linkedin.com/company/acme',
                location: 'Hamburg',
                postedAt: '2026-07-21',
                onClick: () =>
                    new Promise<void>((resolve) => setTimeout(resolve, 1400)),
            }),
            createFakeJobLocator({
                title: 'Fullstack Developer',
                listCompany: 'Acme',
                sourceJobId: '333',
                sourceUrl:
                    'https://www.linkedin.com/jobs/view/fullstack-developer-at-acme-333',
                companyUrl: 'https://de.linkedin.com/company/acme',
                location: 'Hamburg',
                postedAt: '2026-07-21',
            }),
        ];
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({
                    nth: (index) => jobLocators[index]!,
                }),
                ...baseScrapeJobLocators(() => 'Acme'),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });
        const results: JobResult[] = [];
        const progressEvents: ScrapeProgressEvent[] = [];

        await scrapeAllJobsOnce(
            {
                page,
                totalJobs: 3,
                seenSourceJobIds: new Map(),
                runTimestamp: 123,
                delayBetweenJobsMs: 0,
                companyLookup: stubCompanyLookup(),
                perJobTimeoutMs: 1200,
                onProgress: (e) => progressEvents.push(e),
            },
            results,
        );

        assert.equal(results.length, 3);
        assert.equal(results[0]?.status, 'success');
        const middle = results[1]!;
        assertFailed(middle);
        assert.equal(
            middle.error,
            'Job exceeded per-job time budget of 1200ms',
        );
        // Still identifiable, and still an ordinary job:done — a timed-out job
        // is a failed job, not a missing one.
        assert.equal(middle.title, 'Backend Developer');
        assert.equal(middle.sourceJobId, '222');
        assert.equal(results[2]?.status, 'success');
        assert.deepEqual(
            progressEvents
                .filter((e) => e.type === 'job:done')
                .map((e) => e.result.index),
            [0, 1, 2],
        );
    });

    it('stops scraping remaining jobs once the signal is aborted mid-run', async ({
        assert,
    }) => {
        const jobLocators = [
            createFakeJobLocator({
                title: 'Frontend Developer',
                listCompany: 'Acme',
                sourceJobId: '111',
                sourceUrl:
                    'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
                companyUrl: 'https://de.linkedin.com/company/acme',
                location: 'Hamburg',
                postedAt: '2026-07-21',
            }),
            createFakeJobLocator({
                title: 'Backend Developer',
                listCompany: 'Acme',
                sourceJobId: '222',
                sourceUrl:
                    'https://www.linkedin.com/jobs/view/backend-developer-at-acme-222',
                companyUrl: 'https://de.linkedin.com/company/acme',
                location: 'Hamburg',
                postedAt: '2026-07-21',
            }),
        ];
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({
                    nth: (index) => jobLocators[index]!,
                }),
                ...baseScrapeJobLocators(() => 'Acme'),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });
        const results: JobResult[] = [];
        const controller = new AbortController();

        await scrapeAllJobsOnce(
            {
                page,
                totalJobs: 2,
                seenSourceJobIds: new Map(),
                runTimestamp: 123,
                delayBetweenJobsMs: 0,
                companyLookup: stubCompanyLookup(),
                signal: controller.signal,
                // Abort as soon as the first job finishes — the in-flight job
                // still completes normally, only the next one is skipped.
                onProgress: () => controller.abort(),
            },
            results,
        );

        assert.equal(results.length, 1);
        assert.equal(results[0]?.index, 0);
    });
});
