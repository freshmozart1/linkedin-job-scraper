import { describe, it } from 'node:test';
import { createFakeLocator, createFakePage } from './helpers/fakePlaywright';
import { scrollLoadPhase, type ScrapeProgressEvent } from '../src';

describe('scrollLoadPhase()', () => {
    it('stops as soon as the see-more button becomes visible', async ({
        assert,
    }) => {
        const page = createFakePage({
            evaluate: () => ['a', 'b', 'c', 'd', 'e'],
        });
        const seeMoreButton = createFakeLocator({ isVisible: () => true });
        const progressEvents: ScrapeProgressEvent[] = [];

        const count = await scrollLoadPhase(page, seeMoreButton, {
            onProgress: (e) => progressEvents.push(e),
        });

        assert.equal(count, 5);
        assert.deepEqual(progressEvents, [{ type: 'jobs:loading', count: 5 }]);
    });

    it('stops once the unique job count is stable for three consecutive reads', async ({
        assert,
    }) => {
        const page = createFakePage({ evaluate: () => [] });
        const seeMoreButton = createFakeLocator({ isVisible: () => false });

        const count = await scrollLoadPhase(page, seeMoreButton);

        assert.equal(count, 0);
    });

    it('stops after a caller-supplied maxScrollAttempts even when the job count keeps growing', async ({
        assert,
    }) => {
        let evaluateCalls = 0;
        const page = createFakePage({
            evaluate: () => {
                evaluateCalls += 1;
                return Array.from(
                    { length: evaluateCalls },
                    (_, i) => `job-${i}`,
                ); // never stable — always a new unique count
            },
        });
        const seeMoreButton = createFakeLocator({ isVisible: () => false });

        await scrollLoadPhase(page, seeMoreButton, { maxScrollAttempts: 1 });

        // exactly one loop iteration: one collectJobIds() read + one scrollTo() side-effect call
        assert.equal(evaluateCalls, 2);
    });
});
