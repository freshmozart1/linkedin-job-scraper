import { describe, it } from 'node:test';
import { JOB_LIST_SELECTOR } from '../src';
import type {
    JobResult,
    ScrapeProgressEvent,
    StaleDiagnostics,
} from '../src';
import { collectJobListState } from '../src/scraper/collectJobListState';
import { retryStaleJobs } from '../src/scraper/retryStaleJobs';
import { scrapeLoadedJobsOnce } from '../src/scraper/scrapeLoadedJobsOnce';
import { baseScrapeJobLocators } from './helpers/baseScrapeJobLocators';
import { createFakeLocator, createFakePage } from './helpers/fakePlaywright';
import { createFakeJobLocator } from './helpers/fakePlaywright/createFakeJobLocator';
import { stubCompanyLookup } from './helpers/stubCompanyLookup';

describe('runScrape unique-card traversal', () => {
    it('scrapes mapped identities beyond duplicate rows and retries the same mapping', async ({
        assert,
    }) => {
        const sourceJobIds = ['101', '101', '102', '102', '103'];
        let currentDetailCompany = 'Acme';
        let currentDetailJobId = '101';
        let job102Clicks = 0;
        const clickedRawIndices: number[] = [];
        const rawJobLocators = sourceJobIds.map((sourceJobId, rawIndex) =>
            createFakeJobLocator({
                title: `Job ${sourceJobId}`,
                listCompany: 'Acme',
                sourceJobId,
                sourceUrl: `https://www.linkedin.com/jobs/view/job-${sourceJobId}`,
                companyUrl: 'https://www.linkedin.com/company/acme',
                location: 'Berlin',
                postedAt: '2026-09-09',
                onClick: () => {
                    clickedRawIndices.push(rawIndex);
                    currentDetailJobId = sourceJobId;
                    if (sourceJobId === '102') {
                        job102Clicks += 1;
                        currentDetailCompany =
                            job102Clicks === 1 ? 'Globex' : 'Acme';
                    } else {
                        currentDetailCompany = 'Acme';
                    }
                },
            }),
        );
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({
                    nth: (rawIndex) => rawJobLocators[rawIndex]!,
                }),
                ...baseScrapeJobLocators(
                    () => currentDetailCompany,
                    'A description.',
                    ['Full-time'],
                    () => currentDetailJobId,
                ),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
            evaluate: () =>
                sourceJobIds.map((sourceJobId) => ({
                    entityUrn: `urn:li:jobPosting:${sourceJobId}`,
                    href: null,
                })),
        });
        const loadedState = await collectJobListState(page);
        const results: JobResult[] = [];
        const progressEvents: ScrapeProgressEvent[] = [];
        const diagnostics: StaleDiagnostics[] = [];
        const shouldScrapeCalls: string[] = [];
        const ctx = {
            page,
            totalJobs: loadedState.uniqueCount,
            seenSourceJobIds: new Map<string, number>(),
            runTimestamp: 123,
            delayBetweenJobsMs: 0,
            companyLookup: stubCompanyLookup(),
            shouldScrapeJob: (identity: { sourceJobId: string | null }) => {
                shouldScrapeCalls.push(identity.sourceJobId ?? 'null');
                return true;
            },
            onProgress: (event: ScrapeProgressEvent) =>
                progressEvents.push(event),
            onJobDiagnostics: (record: StaleDiagnostics) =>
                diagnostics.push(record),
        };

        assert.deepEqual(loadedState.uniqueJobs, [
            { sourceJobId: '101', rawIndex: 0 },
            { sourceJobId: '102', rawIndex: 2 },
            { sourceJobId: '103', rawIndex: 4 },
        ]);

        const retryIndices = await scrapeLoadedJobsOnce(
            ctx,
            results,
            loadedState.uniqueJobs,
        );
        assert.deepEqual(retryIndices, [1]);
        await retryStaleJobs(
            ctx,
            results,
            retryIndices,
            loadedState.uniqueJobs,
        );

        assert.deepEqual(clickedRawIndices, [0, 2, 4, 2]);
        assert.deepEqual(shouldScrapeCalls, ['101', '102', '103', '102']);
        assert.deepEqual(
            results.map((result) => ({
                index: result.index,
                sourceJobId: result.sourceJobId,
                duplicateOfIdx: result.duplicateOfIdx,
                status: result.status,
            })),
            [
                {
                    index: 0,
                    sourceJobId: '101',
                    duplicateOfIdx: null,
                    status: 'success',
                },
                {
                    index: 1,
                    sourceJobId: '102',
                    duplicateOfIdx: null,
                    status: 'success',
                },
                {
                    index: 2,
                    sourceJobId: '103',
                    duplicateOfIdx: null,
                    status: 'success',
                },
            ],
        );
        assert.deepEqual(
            progressEvents
                .filter((event) => event.type === 'job:start')
                .map((event) => event.index),
            [0, 1, 2, 1],
        );
        assert.deepEqual(
            diagnostics.map(({ index, pass, sourceJobId }) => ({
                index,
                pass,
                sourceJobId,
            })),
            [
                { index: 0, pass: 'first', sourceJobId: '101' },
                { index: 1, pass: 'first', sourceJobId: '102' },
                { index: 2, pass: 'first', sourceJobId: '103' },
                { index: 1, pass: 'retry', sourceJobId: '102' },
            ],
        );
        assert.deepEqual([...ctx.seenSourceJobIds], [
            ['101', 0],
            ['102', 1],
            ['103', 2],
        ]);
    });

    it('applies maxJobs to the first unique postings, not raw card positions', async ({
        assert,
    }) => {
        const page = createFakePage({
            evaluate: () =>
                ['1', '1', '2', '2', '3'].map((sourceJobId) => ({
                    entityUrn: `urn:li:jobPosting:${sourceJobId}`,
                    href: null,
                })),
        });
        const loadedState = await collectJobListState(page);

        assert.deepEqual(loadedState.uniqueJobs.slice(0, 2), [
            { sourceJobId: '1', rawIndex: 0 },
            { sourceJobId: '2', rawIndex: 2 },
        ]);
    });

    for (const scenario of [
        {
            name: 'follows a posting that moved from its recorded raw position',
            sourceJobIds: ['101', '102'],
            loadedJob: { sourceJobId: '102', rawIndex: 0 },
            expectedTitle: 'Job at 1',
            expectedStatus: 'success',
            expectedClicks: [1],
            expectedError: undefined,
        },
        {
            name: 'refuses a different card when the mapped posting disappeared',
            sourceJobIds: ['101'],
            loadedJob: { sourceJobId: '102', rawIndex: 0 },
            expectedTitle: 'Job at 0',
            expectedStatus: 'failed',
            expectedClicks: [],
            expectedError:
                'Loaded job 102 is no longer available at its mapped list position',
        },
        {
            name: 'retains the recorded raw position for an unparseable card',
            sourceJobIds: [null, null],
            loadedJob: { sourceJobId: null, rawIndex: 1 },
            expectedTitle: 'Job at 1',
            expectedStatus: 'failed',
            expectedClicks: [],
            expectedError:
                'No source job ID found for job item - LinkedIn markup has likely changed',
        },
    ]) {
        it(scenario.name, async ({ assert }) => {
            let detailJobId: string | null = null;
            const clicks: number[] = [];
            const jobLocators = scenario.sourceJobIds.map((sourceJobId, rawIndex) =>
                createFakeJobLocator({
                    title: `Job at ${rawIndex}`,
                    listCompany: 'Acme',
                    sourceJobId,
                    sourceUrl: sourceJobId
                        ? `https://www.linkedin.com/jobs/view/job-${sourceJobId}`
                        : 'https://www.linkedin.com/jobs/view/unparseable',
                    companyUrl: 'https://www.linkedin.com/company/acme',
                    location: 'Berlin',
                    postedAt: '2026-09-09',
                    onClick: () => {
                        clicks.push(rawIndex);
                        detailJobId = sourceJobId;
                    },
                }),
            );
            const page = createFakePage({
                locatorsBySelector: {
                    [JOB_LIST_SELECTOR]: createFakeLocator({
                        nth: (rawIndex) => jobLocators[rawIndex]!,
                    }),
                    ...baseScrapeJobLocators(
                        () => 'Acme',
                        'A description.',
                        ['Full-time'],
                        () => detailJobId,
                    ),
                },
                defaultLocator: createFakeLocator({
                    waitFor: () => {},
                    isVisible: () => false,
                }),
                evaluate: () =>
                    scenario.sourceJobIds.map((sourceJobId) => ({
                        entityUrn: sourceJobId
                            ? `urn:li:jobPosting:${sourceJobId}`
                            : null,
                        href: null,
                    })),
            });
            const results: JobResult[] = [];

            await scrapeLoadedJobsOnce(
                {
                    page,
                    totalJobs: 1,
                    seenSourceJobIds: new Map(),
                    runTimestamp: 123,
                    delayBetweenJobsMs: 0,
                    companyLookup: stubCompanyLookup(),
                },
                results,
                [scenario.loadedJob],
            );

            assert.equal(results.length, 1);
            assert.equal(results[0]?.status, scenario.expectedStatus);
            assert.equal(results[0]?.title, scenario.expectedTitle);
            assert.deepEqual(clicks, scenario.expectedClicks);
            if (results[0]?.status === 'failed') {
                assert.equal(results[0].error, scenario.expectedError);
                assert.equal(results[0].descriptionText, null);
            }
        });
    }
});
