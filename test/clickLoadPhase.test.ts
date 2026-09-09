import { describe, it } from 'node:test';
import { createFakeLocator, createFakePage } from './helpers/fakePlaywright';
import {
    OVERLAY_SELECTOR,
    VIEWED_ALL_JOBS_SELECTOR,
    clickLoadPhase,
    type ScrapeProgressEvent,
} from '../src';

function jobCards(sourceJobIds: string[]) {
    return sourceJobIds.map((sourceJobId) => ({
        entityUrn: `urn:li:jobPosting:${sourceJobId}`,
        href: null,
    }));
}

function createJobListReader(reads: string[][]) {
    let readIndex = 0;
    return () =>
        jobCards(reads[Math.min(readIndex++, reads.length - 1)] ?? []);
}

describe('clickLoadPhase()', () => {
    it('stops immediately when the "viewed all jobs" banner is visible', async ({
        assert,
    }) => {
        let clicked = false;
        const seeMoreButton = createFakeLocator({
            isVisible: () => true,
            click: () => {
                clicked = true;
            },
        });
        const page = createFakePage({
            locatorsBySelector: {
                [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({
                    isVisible: () => true,
                }),
            },
        });

        await clickLoadPhase(page, seeMoreButton, 10);

        assert.equal(clicked, false);
    });

    it('stops immediately once the see-more button is no longer visible', async ({
        assert,
    }) => {
        let clicked = false;
        const seeMoreButton = createFakeLocator({
            isVisible: () => false,
            click: () => {
                clicked = true;
            },
        });
        const page = createFakePage({
            locatorsBySelector: {
                [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
            },
        });

        await clickLoadPhase(page, seeMoreButton, 10);

        assert.equal(clicked, false);
    });

    it('clicks the see-more button, waits for growth, and reports progress before stopping', async ({
        assert,
    }) => {
        let seeMoreVisibleCalls = 0;
        const seeMoreButton = createFakeLocator({
            isVisible: () => {
                seeMoreVisibleCalls += 1;
                return seeMoreVisibleCalls === 1; // visible once, gone on the next check
            },
        });
        const page = createFakePage({
            locatorsBySelector: {
                [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
                [OVERLAY_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
            },
            evaluate: createJobListReader([
                ['1', '2', '3', '4', '5'],
                ['1', '2', '3', '4', '5', '6', '7', '8'],
            ]),
        });
        const progressEvents: ScrapeProgressEvent[] = [];

        await clickLoadPhase(page, seeMoreButton, 5, {
            onProgress: (e) => progressEvents.push(e),
        });

        assert.deepEqual(progressEvents, [{ type: 'jobs:loading', count: 8 }]);
    });

    it('honors a caller-supplied clickRetryAttempts instead of the default 4', async ({
        assert,
    }) => {
        let clickAttempts = 0;
        const seeMoreButton = createFakeLocator({
            isVisible: () => true,
            click: () => {
                clickAttempts += 1;
                throw new Error('click intercepted by another overlay');
            },
        });
        const page = createFakePage({
            locatorsBySelector: {
                [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
                [OVERLAY_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
            },
            evaluate: () => [],
        });

        await assert.rejects(() =>
            clickLoadPhase(page, seeMoreButton, 0, { clickRetryAttempts: 1 }),
        );
        assert.equal(clickAttempts, 1);
    });

    it('stops immediately when the signal is already aborted, without clicking', async ({
        assert,
    }) => {
        let clicked = false;
        const seeMoreButton = createFakeLocator({
            isVisible: () => true,
            click: () => {
                clicked = true;
            },
        });
        const page = createFakePage({
            locatorsBySelector: {
                [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
            },
        });
        const controller = new AbortController();
        controller.abort();

        await clickLoadPhase(page, seeMoreButton, 10, {
            signal: controller.signal,
        });

        assert.equal(clicked, false);
    });

    it('continues through duplicate-only batches and reports only later unique growth', async ({
        assert,
    }) => {
        let visibilityChecks = 0;
        let clicks = 0;
        const seeMoreButton = createFakeLocator({
            isVisible: () => ++visibilityChecks <= 3,
            click: () => {
                clicks += 1;
            },
        });
        const page = createFakePage({
            locatorsBySelector: {
                [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
                [OVERLAY_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
            },
            evaluate: createJobListReader([
                ['1', '2', '3', '4', '5'],
                ['1', '2', '3', '4', '5', '1'],
                ['1', '2', '3', '4', '5', '1', '2'],
                ['1', '2', '3', '4', '5', '1', '2', '6'],
            ]),
        });
        const progressEvents: ScrapeProgressEvent[] = [];

        await clickLoadPhase(page, seeMoreButton, 5, {
            stableClicksToStop: 1,
            onProgress: (event) => progressEvents.push(event),
        });

        assert.equal(clicks, 3);
        assert.deepEqual(progressEvents, [
            { type: 'jobs:loading', count: 6 },
        ]);
    });

    it('treats no raw or unique growth as true exhaustion', async ({
        assert,
    }) => {
        let clicks = 0;
        const seeMoreButton = createFakeLocator({
            isVisible: () => true,
            click: () => {
                clicks += 1;
            },
        });
        const page = createFakePage({
            locatorsBySelector: {
                [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
                [OVERLAY_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
            },
            evaluate: createJobListReader([['1', '2', '3']]),
        });
        const progressEvents: ScrapeProgressEvent[] = [];

        await clickLoadPhase(page, seeMoreButton, 3, {
            stableClicksToStop: 1,
            onProgress: (event) => progressEvents.push(event),
        });

        assert.equal(clicks, 1);
        assert.deepEqual(progressEvents, []);
    });

    it('bounds endlessly appended duplicate rows with maxSeeMoreClicks', async ({
        assert,
    }) => {
        let clicks = 0;
        const seeMoreButton = createFakeLocator({
            isVisible: () => true,
            click: () => {
                clicks += 1;
            },
        });
        const page = createFakePage({
            locatorsBySelector: {
                [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
                [OVERLAY_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
            },
            evaluate: createJobListReader([
                ['1'],
                ['1', '1'],
                ['1', '1', '1'],
                ['1', '1', '1', '1'],
            ]),
        });
        const progressEvents: ScrapeProgressEvent[] = [];

        await clickLoadPhase(page, seeMoreButton, 1, {
            maxSeeMoreClicks: 3,
            stableClicksToStop: 1,
            onProgress: (event) => progressEvents.push(event),
        });

        assert.equal(clicks, 3);
        assert.deepEqual(progressEvents, []);
    });
});
