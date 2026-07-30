import { describe, it } from 'node:test';
import { createFakeLocator, createFakePage } from './helpers/fakePlaywright';
import { scrollLoadPhase, type ScrapeProgressEvent } from '../src';

/**
 * Models the three call shapes scrollLoadPhase() makes through
 * page.evaluate(): the one-time hide-sections call (always the very first
 * evaluate() call it makes, whatever arg it's given — its return value is
 * unused, so it's safe to just swallow), repeated collectJobIds()-shaped
 * reads (called with no arg thereafter), and per-<li> scroll calls (called
 * with the <li> index as an explicit numeric arg, expecting that <li>'s
 * height back, or `null` once the index is past the currently-rendered
 * range).
 *
 * `jobIdReads` is consumed one array per collectJobIds() read, repeating
 * its last entry once exhausted. `liHeightAt` is invoked once per per-<li>
 * scroll step, so a test can make it stateful to model LinkedIn appending
 * more <li>s mid-phase.
 */
function createScrollPage(config: {
    jobIdReads: string[][];
    liHeightAt?: (index: number) => number | null;
}) {
    const { jobIdReads, liHeightAt = () => null } = config;
    let hideSectionsSeen = false;
    let reads = 0;
    return createFakePage({
        evaluate: (arg?: unknown) => {
            if (!hideSectionsSeen) {
                hideSectionsSeen = true;
                return undefined;
            }
            if (typeof arg === 'number') return liHeightAt(arg);
            const batch =
                jobIdReads[Math.min(reads, jobIdReads.length - 1)] ?? [];
            reads += 1;
            return batch;
        },
    });
}

describe('scrollLoadPhase()', () => {
    it('stops as soon as the see-more button becomes visible', async ({
        assert,
    }) => {
        const page = createScrollPage({
            jobIdReads: [['a', 'b', 'c', 'd', 'e']],
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
        const page = createScrollPage({ jobIdReads: [[]] });
        const seeMoreButton = createFakeLocator({ isVisible: () => false });

        const count = await scrollLoadPhase(page, seeMoreButton);

        assert.equal(count, 0);
    });

    it('stops after a caller-supplied maxScrollAttempts even when the job count keeps growing', async ({
        assert,
    }) => {
        let evaluateCalls = 0;
        const page = createFakePage({
            evaluate: (arg?: unknown) => {
                if (typeof arg === 'number') return null; // no <li>s to scroll — not under test here
                evaluateCalls += 1;
                // never stable — always a new unique count. The first call
                // is the one-time hide-sections call; its return is unused.
                return Array.from(
                    { length: evaluateCalls },
                    (_, i) => `job-${i}`,
                );
            },
        });
        const seeMoreButton = createFakeLocator({ isVisible: () => false });

        await scrollLoadPhase(page, seeMoreButton, { maxScrollAttempts: 1 });

        // hide-sections's one-time call, plus exactly one collectJobIds()
        // read — the single permitted attempt never reaches a second read.
        assert.equal(evaluateCalls, 2);
    });

    it('keeps scrolling once LinkedIn appends more <li>s than were rendered initially, instead of stopping at a pass that only looks exhausted', async ({
        assert,
    }) => {
        // 2 <li>s rendered up front; a 3rd only becomes scrollable once the
        // phase revisits index 2 on a later pass — reproducing the growth
        // LinkedIn only serves after real incremental scroll progress (see
        // GitHub issue #10's root cause). Kept to a handful of items so the
        // real sleep(120)/sleep(800) waits this exercises stay bounded.
        const liHeights = [30, 30];
        let appended = false;
        const page = createScrollPage({
            jobIdReads: [
                ['a', 'b'],
                ['a', 'b'],
                ['a', 'b', 'c'],
            ],
            liHeightAt: (index) => {
                if (index === 2) {
                    if (!appended) {
                        appended = true; // revisiting index 2 next time will find it
                        return null;
                    }
                    return 30;
                }
                return liHeights[index] ?? null;
            },
        });
        const seeMoreButton = createFakeLocator({ isVisible: () => false });

        const count = await scrollLoadPhase(page, seeMoreButton, {
            stableScrollsToStop: 2,
        });

        assert.equal(count, 3);
    });
});
