import { describe, it, TestContext } from 'node:test';
import {
    createFakeLocator,
    createFakePage,
    createFakeJobLocator,
} from './helpers/fakePlaywright';
import {
    JOB_LIST_SELECTOR,
    JOB_CRITERIA_VALUE_SELECTOR,
    scrapeJob,
} from '../src';
import type { CompanyAddress } from '../src';
import { baseScrapeJobLocators } from './helpers/baseScrapeJobLocators';
import { stubCompanyLookup } from './helpers/stubCompanyLookup';
import { scrapeSingleJob } from './helpers/scrapeSingleJob';
import { assertFailed } from './helpers/assertFailed';
import type { AttributeRead } from './helpers/fakePlaywright/interfaces';

describe('scrapeJob()', () => {
    const FRANKFURT: CompanyAddress = {
        streetAddress: 'Bockenheimer Anlage 46',
        city: 'Frankfurt',
        postalCode: 'Hesse 60322',
        countryCode: 'DE',
    };

    it('returns a success result with the scraped title, company, and description', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            location: 'Berlin, Berlin, Germany',
            postedAt: '2026-07-21',
            companyUrl: 'https://de.linkedin.com/company/yatta-solutions-gmbh',
        });
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
                ...baseScrapeJobLocators(() => 'Acme'),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });

        const result = await scrapeJob(page, 0, {
            seenSourceJobIds: new Map(),
            runTimestamp: 123,
            companyLookup: stubCompanyLookup(),
        });

        assert.equal(result.status, 'success');
        assert.equal(result.title, 'Frontend Developer');
        assert.equal(result.company, 'Acme');
        assert.equal(result.descriptionText, 'A description.');
        assert.equal(result.companyMismatch, false);
        assert.equal(result.sourceJobIdMismatch, false);
        assert.equal(result.lateOverlayDetected, false);
        assert.equal(result.sourceJobId, '111');
        assert.equal(
            result.sourceUrl,
            'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
        );
        assert.equal(result.sourceHostname, 'de.linkedin.com');
        assert.match(
            result.scrapedAt,
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        );
        assert.equal(result.duplicateOfIdx, null);
        assert.equal(result.location, 'Berlin, Berlin, Germany');
        assert.equal(result.postedAt, '2026-07-21');
        assert.deepEqual(result.tags, ['Full-time']);
    });
    it('flags a same-company stale detail pane via sourceJobIdMismatch even though companyMismatch misses it', async ({
        assert,
    }) => {
        // Reproduces GitHub issue #17: the detail pane is left over from an
        // earlier posting at the *same* company ('Acme' on both sides), so
        // companyMismatch can't see it — but the detail pane's own title
        // link still carries the earlier job's ID ('111'), not this job's
        // ('222'), which is what sourceJobIdMismatch is for.
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '222',
            sourceUrl:
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-222',
            location: 'Berlin, Berlin, Germany',
            postedAt: '2026-07-21',
            companyUrl: 'https://de.linkedin.com/company/acme',
        });
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
                ...baseScrapeJobLocators(
                    () => 'Acme',
                    'A description.',
                    ['Full-time'],
                    '111',
                ),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });

        const result = await scrapeJob(page, 0, {
            seenSourceJobIds: new Map(),
            runTimestamp: 123,
            companyLookup: stubCompanyLookup(),
        });

        assert.equal(result.status, 'success');
        assert.equal(result.companyMismatch, false);
        assert.equal(result.sourceJobIdMismatch, true);
    });
    it('returns a failed result when the list item has no job title', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: null,
            listCompany: null,
            sourceJobId: null,
            hasTitle: false,
        });
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
            },
        });

        const result = await scrapeJob(page, 7, {
            seenSourceJobIds: new Map(),
            runTimestamp: 123,
            companyLookup: stubCompanyLookup(),
        });

        assertFailed(result);
        assert.equal(
            result.error,
            'No job title found for this list item - LinkedIn markup has likely changed',
        );
    });
    it('marks a repeated posting ID as a duplicate of its first occurrence', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
                ...baseScrapeJobLocators(() => 'Acme'),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });
        const seenSourceJobIds = new Map<string, number>([['111', 0]]);

        const result = await scrapeJob(page, 3, {
            seenSourceJobIds,
            runTimestamp: 123,
            companyLookup: stubCompanyLookup(),
        });

        assert.equal(result.status, 'success');
        assert.equal(result.duplicateOfIdx, 0);
    });
    it('returns a failed result when an unexpected error is thrown', async ({
        assert,
    }) => {
        const jobItem = createFakeLocator({
            scrollIntoViewIfNeeded: () => {
                throw new Error('element detached from DOM');
            },
        });
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
            },
        });

        const result = await scrapeJob(page, 2, {
            seenSourceJobIds: new Map(),
            runTimestamp: 123,
            companyLookup: stubCompanyLookup(),
        });

        assertFailed(result);
        assert.match(result.error, /element detached from DOM/);
    });

    it('reads the company link off the card and normalizes it into companyUrl', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Yatta',
            sourceJobId: '111',
            location: 'Hamburg',
            postedAt: '2026-07-21',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/frontend-developer-at-yatta-111',
            companyUrl:
                'https://de.linkedin.com/company/yatta-solutions-gmbh?trk=public_jobs_jserp-result',
        });

        const result = await scrapeSingleJob(jobItem);

        assert.equal(
            result.companyUrl,
            'https://de.linkedin.com/company/yatta-solutions-gmbh',
        );
    });

    it('resolves a relative job href against the search page URL', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl: '/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });

        const result = await scrapeSingleJob(
            jobItem,
            'https://de.linkedin.com/jobs/search?keywords=frontend',
        );

        assert.equal(
            result.sourceUrl,
            'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
        );
        assert.equal(result.sourceHostname, 'de.linkedin.com');
    });

    it('strips per-session tracking params so sourceUrl is stable across runs', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111?refId=xY7%2Fabc&trackingId=Qk9%3D&position=3&pageNum=0&trk=public_jobs_jserp-result_search-card',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });

        const result = await scrapeSingleJob(jobItem);

        assert.equal(
            result.sourceUrl,
            'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
        );
        assert.equal(result.sourceHostname, 'de.linkedin.com');
    });

    it('returns a failed result for an href with no hostname', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl: 'javascript:void(0)',
        });

        const result = await scrapeSingleJob(jobItem);

        assertFailed(result);
        assert.equal(
            result.error,
            'No job URL hostname found for this list item',
        );
    });

    it('returns a failed result when the card has no job link', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl: '',
        });

        const result = await scrapeSingleJob(jobItem);

        assertFailed(result);
        assert.equal(result.error, 'No job href found for this list item');
    });

    it('returns a failed result when the card has no company link', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
        });

        const result = await scrapeSingleJob(jobItem);

        assertFailed(result);
        assert.equal(result.error, 'No company href found for list item');
    });

    it('resolves a relative company href against the search page URL', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Yatta',
            sourceJobId: '111',
            sourceUrl: '/jobs/view/frontend-developer-at-yatta-111',
            companyUrl: '/company/yatta-solutions-gmbh',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });

        const result = await scrapeSingleJob(
            jobItem,
            'https://de.linkedin.com/jobs/search?keywords=frontend',
        );

        assert.equal(
            result.companyUrl,
            'https://de.linkedin.com/company/yatta-solutions-gmbh',
        );
    });

    it('returns a failed result when the list card has no location', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
        });

        const result = await scrapeSingleJob(jobItem);

        assertFailed(result);
        assert.equal(result.error, 'No location found for list item');
    });

    it('returns a failed result when the list card has no posted-at date', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
        });

        const result = await scrapeSingleJob(jobItem);

        assertFailed(result);
        assert.equal(result.error, 'No posted date found for list item');
    });

    it('returns a failed result when the posted-at datetime read itself throws', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAtUnreadable: true,
        });

        const result = await scrapeSingleJob(jobItem);

        assertFailed(result);
        assert.equal(result.error, 'No posted date found for list item');
    });

    it('falls back to the href for sourceJobId when data-entity-urn is unreadable', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: null,
            entityUrnUnreadable: true,
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
            sourceUrl:
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-4012345678?refId=abc',
        });

        const result = await scrapeSingleJob(jobItem);

        // A failed urn read must not take the whole identity down with it: the
        // posting ID is recoverable from the href, and duplicate detection plus
        // the detail-pane wait both depend on having it.
        assert.equal(result.status, 'success');
        assert.equal(result.sourceJobId, '4012345678');
        assert.equal(
            result.sourceUrl,
            'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-4012345678',
        );
    });

    it('bounds every card attribute read with an explicit timeout', async (t: TestContext) => {
        const attributeReads: AttributeRead[] = [];
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            attributeReads,
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });

        await scrapeSingleJob(jobItem);

        t.assert.ok(
            attributeReads.length >= 3,
            'expected the urn, job href and company href reads to be recorded',
        );
        for (const read of attributeReads) {
            t.assert.ok(
                typeof read.options?.timeout === 'number' &&
                    read.options.timeout <= 1000,
                `getAttribute(${read.name}) was given no bounded timeout: ${JSON.stringify(read.options)}`,
            );
        }
    });

    it('looks the company addresses up by companyUrl and attaches them to the result', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Yatta',
            sourceJobId: '111',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/frontend-developer-at-yatta-111',
            companyUrl: 'https://de.linkedin.com/company/yatta-solutions-gmbh',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });
        const lookup = stubCompanyLookup([FRANKFURT]);

        const result = await scrapeSingleJob(jobItem, undefined, lookup);

        assert.deepEqual(lookup.requested, [
            'https://de.linkedin.com/company/yatta-solutions-gmbh',
        ]);
        assert.deepEqual(result.companyAddresses, [FRANKFURT]);
    });

    it('keeps status success with null companyAddresses when the lookup could not read the page', async ({
        assert,
    }) => {
        // A blocked or broken company page must never turn a perfectly good job
        // scrape into a failure.
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Yatta',
            sourceJobId: '111',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/frontend-developer-at-yatta-111',
            companyUrl: 'https://de.linkedin.com/company/yatta-solutions-gmbh',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });

        const result = await scrapeSingleJob(
            jobItem,
            undefined,
            stubCompanyLookup(null),
        );

        assert.equal(result.status, 'success');
        assert.equal(result.descriptionText, 'A description.');
        assert.equal(result.companyAddresses, null);
    });

    it('returns the tags read from the detail pane job-criteria list', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
                ...baseScrapeJobLocators(() => 'Acme', 'A description.', [
                    'Not Applicable',
                    'Full-time',
                    'Engineering and Information Technology',
                    'Professional Training and Coaching',
                ]),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });

        const result = await scrapeJob(page, 0, {
            seenSourceJobIds: new Map(),
            runTimestamp: 123,
            companyLookup: stubCompanyLookup(),
        });

        assert.deepEqual(result.tags, [
            'Not Applicable',
            'Full-time',
            'Engineering and Information Technology',
            'Professional Training and Coaching',
        ]);
    });

    it('returns an empty tags array when the job genuinely lists no criteria', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
                ...baseScrapeJobLocators(() => 'Acme', 'A description.', []),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });

        const result = await scrapeJob(page, 0, {
            seenSourceJobIds: new Map(),
            runTimestamp: 123,
            companyLookup: stubCompanyLookup(),
        });

        assert.equal(result.status, 'success');
        assert.deepEqual(result.tags, []);
    });

    it('returns a failed result when the job-criteria read itself fails', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
                ...baseScrapeJobLocators(() => 'Acme'),
                [JOB_CRITERIA_VALUE_SELECTOR]: createFakeLocator({
                    waitFor: () => {},
                    allInnerTexts: () => {
                        throw new Error('detached from DOM');
                    },
                }),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });

        const result = await scrapeJob(page, 0, {
            seenSourceJobIds: new Map(),
            runTimestamp: 123,
            companyLookup: stubCompanyLookup(),
        });

        assertFailed(result);
        assert.equal(result.error, 'No job criteria found for job item');
    });

    it('waits for the job-criteria list to attach before reading tags', async ({
        assert,
    }) => {
        const calls: string[] = [];
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
                ...baseScrapeJobLocators(() => 'Acme'),
                [JOB_CRITERIA_VALUE_SELECTOR]: createFakeLocator({
                    waitFor: () => {
                        calls.push('waitFor');
                    },
                    allInnerTexts: () => {
                        calls.push('allInnerTexts');
                        return ['Full-time'];
                    },
                }),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });

        const result = await scrapeJob(page, 0, {
            seenSourceJobIds: new Map(),
            runTimestamp: 123,
            companyLookup: stubCompanyLookup(),
        });

        assert.deepEqual(calls, ['waitFor', 'allInnerTexts']);
        assert.deepEqual(result.tags, ['Full-time']);
    });

    it('still reads tags when the job-criteria attach-wait itself times out', async ({
        assert,
    }) => {
        const jobItem = createFakeJobLocator({
            title: 'Frontend Developer',
            listCompany: 'Acme',
            sourceJobId: '111',
            sourceUrl:
                'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            companyUrl: 'https://de.linkedin.com/company/acme',
            location: 'Hamburg',
            postedAt: '2026-07-21',
        });
        const page = createFakePage({
            locatorsBySelector: {
                [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
                ...baseScrapeJobLocators(() => 'Acme'),
                [JOB_CRITERIA_VALUE_SELECTOR]: createFakeLocator({
                    waitFor: () => {
                        throw new Error(
                            'locator.waitFor: Timeout 1000ms exceeded',
                        );
                    },
                    allInnerTexts: () => ['Full-time'],
                }),
            },
            defaultLocator: createFakeLocator({
                waitFor: () => {},
                isVisible: () => false,
            }),
        });

        const result = await scrapeJob(page, 0, {
            seenSourceJobIds: new Map(),
            runTimestamp: 123,
            companyLookup: stubCompanyLookup(),
        });

        assert.equal(result.status, 'success');
        assert.deepEqual(result.tags, ['Full-time']);
    });

    describe('shouldScrapeJob', () => {
        it('returns a skipped result with the list-card identity when shouldScrapeJob returns false', async ({
            assert,
        }) => {
            const jobItem = createFakeJobLocator({
                title: 'Frontend Developer',
                listCompany: 'Acme',
                sourceJobId: '111',
                sourceUrl:
                    'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
                location: 'Berlin, Berlin, Germany',
                postedAt: '2026-07-21',
                companyUrl: 'https://de.linkedin.com/company/acme',
            });
            const page = createFakePage({
                locatorsBySelector: {
                    [JOB_LIST_SELECTOR]: createFakeLocator({
                        nth: () => jobItem,
                    }),
                    ...baseScrapeJobLocators(() => 'Acme'),
                },
                defaultLocator: createFakeLocator({
                    waitFor: () => {},
                    isVisible: () => false,
                }),
            });

            const result = await scrapeJob(page, 0, {
                seenSourceJobIds: new Map(),
                runTimestamp: 123,
                companyLookup: stubCompanyLookup(),
                shouldScrapeJob: () => false,
            });

            assert.equal(result.status, 'skipped');
            assert.equal(result.title, 'Frontend Developer');
            assert.equal(result.sourceJobId, '111');
            assert.equal(
                result.sourceUrl,
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            );
            assert.equal(result.sourceHostname, 'de.linkedin.com');
            assert.equal(
                result.companyUrl,
                'https://de.linkedin.com/company/acme',
            );
            assert.equal(result.location, 'Berlin, Berlin, Germany');
            assert.equal(result.postedAt, '2026-07-21');
            assert.equal(result.company, null);
            assert.equal(result.descriptionText, null);
            assert.equal(result.companyAddresses, null);
            assert.equal(result.tags, null);
            assert.equal(result.duplicateOfIdx, null);
        });

        it('never clicks the job card when shouldScrapeJob returns false', async ({
            assert,
        }) => {
            const clicks: number[] = [];
            const jobItem = createFakeJobLocator({
                title: 'Frontend Developer',
                listCompany: 'Acme',
                sourceJobId: '111',
                sourceUrl:
                    'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
                location: 'Berlin, Berlin, Germany',
                postedAt: '2026-07-21',
                companyUrl: 'https://de.linkedin.com/company/acme',
                onClick: () => {
                    clicks.push(1);
                },
            });
            const page = createFakePage({
                locatorsBySelector: {
                    [JOB_LIST_SELECTOR]: createFakeLocator({
                        nth: () => jobItem,
                    }),
                    ...baseScrapeJobLocators(() => 'Acme'),
                },
                defaultLocator: createFakeLocator({
                    waitFor: () => {},
                    isVisible: () => false,
                }),
            });

            await scrapeJob(page, 0, {
                seenSourceJobIds: new Map(),
                runTimestamp: 123,
                companyLookup: stubCompanyLookup(),
                shouldScrapeJob: () => false,
            });

            assert.deepEqual(clicks, []);
        });

        it('invokes shouldScrapeJob with exactly the 7 list-level identity fields', async ({
            assert,
        }) => {
            const jobItem = createFakeJobLocator({
                title: 'Frontend Developer',
                listCompany: 'Acme',
                sourceJobId: '111',
                sourceUrl:
                    'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
                location: 'Berlin, Berlin, Germany',
                postedAt: '2026-07-21',
                companyUrl: 'https://de.linkedin.com/company/acme',
            });
            const page = createFakePage({
                locatorsBySelector: {
                    [JOB_LIST_SELECTOR]: createFakeLocator({
                        nth: () => jobItem,
                    }),
                    ...baseScrapeJobLocators(() => 'Acme'),
                },
                defaultLocator: createFakeLocator({
                    waitFor: () => {},
                    isVisible: () => false,
                }),
            });
            let receivedIdentity: unknown = null;

            await scrapeJob(page, 0, {
                seenSourceJobIds: new Map(),
                runTimestamp: 123,
                companyLookup: stubCompanyLookup(),
                shouldScrapeJob: (identity) => {
                    receivedIdentity = identity;
                    return true;
                },
            });

            assert.deepEqual(receivedIdentity, {
                title: 'Frontend Developer',
                sourceUrl:
                    'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
                sourceHostname: 'de.linkedin.com',
                sourceJobId: '111',
                companyUrl: 'https://de.linkedin.com/company/acme',
                location: 'Berlin, Berlin, Germany',
                postedAt: '2026-07-21',
            });
        });

        it('still fully scrapes the job to status success when shouldScrapeJob returns true', async ({
            assert,
        }) => {
            const jobItem = createFakeJobLocator({
                title: 'Frontend Developer',
                listCompany: 'Acme',
                sourceJobId: '111',
                sourceUrl:
                    'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
                location: 'Berlin, Berlin, Germany',
                postedAt: '2026-07-21',
                companyUrl: 'https://de.linkedin.com/company/acme',
            });
            const page = createFakePage({
                locatorsBySelector: {
                    [JOB_LIST_SELECTOR]: createFakeLocator({
                        nth: () => jobItem,
                    }),
                    ...baseScrapeJobLocators(() => 'Acme'),
                },
                defaultLocator: createFakeLocator({
                    waitFor: () => {},
                    isVisible: () => false,
                }),
            });

            const result = await scrapeJob(page, 0, {
                seenSourceJobIds: new Map(),
                runTimestamp: 123,
                companyLookup: stubCompanyLookup(),
                shouldScrapeJob: () => true,
            });

            assert.equal(result.status, 'success');
            assert.equal(result.title, 'Frontend Developer');
            assert.equal(result.company, 'Acme');
            assert.equal(result.descriptionText, 'A description.');
        });

        it('does not register a skipped job in seenSourceJobIds', async ({
            assert,
        }) => {
            const jobItem = createFakeJobLocator({
                title: 'Frontend Developer',
                listCompany: 'Acme',
                sourceJobId: '111',
                sourceUrl:
                    'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
                location: 'Berlin, Berlin, Germany',
                postedAt: '2026-07-21',
                companyUrl: 'https://de.linkedin.com/company/acme',
            });
            const page = createFakePage({
                locatorsBySelector: {
                    [JOB_LIST_SELECTOR]: createFakeLocator({
                        nth: () => jobItem,
                    }),
                    ...baseScrapeJobLocators(() => 'Acme'),
                },
                defaultLocator: createFakeLocator({
                    waitFor: () => {},
                    isVisible: () => false,
                }),
            });
            const seenSourceJobIds = new Map<string, number>();

            await scrapeJob(page, 0, {
                seenSourceJobIds,
                runTimestamp: 123,
                companyLookup: stubCompanyLookup(),
                shouldScrapeJob: () => false,
            });

            assert.equal(seenSourceJobIds.size, 0);
        });
    });
});
