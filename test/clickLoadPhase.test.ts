import { describe, it } from 'node:test';
import { createFakeLocator, createFakePage } from './helpers/fakePlaywright';
import {
    OVERLAY_SELECTOR,
    VIEWED_ALL_JOBS_SELECTOR,
    clickLoadPhase,
    type ScrapeProgressEvent,
} from '../src';

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
            evaluate: () => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
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
        });

        await assert.rejects(() =>
            clickLoadPhase(page, seeMoreButton, 0, { clickRetryAttempts: 1 }),
        );
        assert.equal(clickAttempts, 1);
    });
});
