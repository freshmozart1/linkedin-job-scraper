import { describe, it } from 'node:test';
import { createFakeLocator, createFakePage } from './helpers/fakePlaywright';
import { scrollLoadPhase, type ScrapeProgressEvent } from '../src';

/**
 * Models the three call shapes scrollLoadPhase() makes through
 * page.evaluate(): the one-time hide-sections call (always the very first
 * evaluate() call it makes, whatever arg it's given — its return value is
 * unused, so it's safe to just swallow), repeated collectJobListState()-shaped
 * reads (called with no arg thereafter), and per-<li> scroll calls (called
 * with the <li> index as an explicit numeric arg, expecting
 * `{ height, renderedCount }` back — `height` is `null` once the index is
 * past the currently-rendered range, `renderedCount` is the live list
 * length read in the same call).
 *
 * `jobIdReads` is consumed one array per collectJobListState() read, repeating
 * its last entry once exhausted. `liInfoAt` is invoked once per per-<li>
 * scroll step, so a test can make it stateful to model LinkedIn appending
 * (or re-serving fewer) <li>s mid-phase.
 */
function createScrollPage(config: {
    jobIdReads: string[][];
    onJobIdRead?: () => void;
    liInfoAt?: (index: number) => {
        height: number | null;
        renderedCount: number;
    };
}) {
    const {
        jobIdReads,
        liInfoAt = () => ({ height: null, renderedCount: 0 }),
    } = config;
    let hideSectionsSeen = false;
    let reads = 0;
    const numericIdByToken = new Map<string, number>();
    return createFakePage({
        evaluate: (arg?: unknown) => {
            if (!hideSectionsSeen) {
                hideSectionsSeen = true;
                return undefined;
            }
            if (typeof arg === 'number') return liInfoAt(arg);
            config.onJobIdRead?.();
            const batch =
                jobIdReads[Math.min(reads, jobIdReads.length - 1)] ?? [];
            reads += 1;
            return batch.map((token) => {
                let numericId = numericIdByToken.get(token);
                if (numericId === undefined) {
                    numericId = numericIdByToken.size + 1;
                    numericIdByToken.set(token, numericId);
                }
                return {
                    entityUrn: `urn:li:jobPosting:${numericId}`,
                    href: null,
                };
            });
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

    it('stops once both the unique job count and raw list are stable for three consecutive reads', async ({
        assert,
    }) => {
        const page = createScrollPage({ jobIdReads: [[]] });
        const seeMoreButton = createFakeLocator({ isVisible: () => false });

        const count = await scrollLoadPhase(page, seeMoreButton);

        assert.equal(count, 0);
    });

    it('continues through duplicate-only pagination batches until a later batch adds unique jobs', async ({
        assert,
    }) => {
        const initialIds = Array.from({ length: 60 }, (_, i) => `job-${i}`);
        const duplicateStart25 = [...initialIds, ...initialIds.slice(0, 10)];
        const duplicateStart50 = [
            ...duplicateStart25,
            ...initialIds.slice(10, 20),
        ];
        const laterIds = [
            ...duplicateStart50,
            ...Array.from({ length: 10 }, (_, i) => `job-${60 + i}`),
        ];
        const progressEvents: ScrapeProgressEvent[] = [];
        let renderedCount = 60;

        const page = createScrollPage({
            jobIdReads: [
                initialIds,
                duplicateStart25,
                duplicateStart50,
                laterIds,
            ],
            // The first two boundaries model duplicate-only start=25 and
            // start=50 responses. The third models start=75: its raw rows
            // arrive first, then the next ID read observes ten new jobs.
            liInfoAt: (index) => {
                if (index < renderedCount) {
                    return { height: 0, renderedCount };
                }
                if (renderedCount < 90) {
                    const countBeforeAppend = renderedCount;
                    renderedCount += 10;
                    return {
                        height: null,
                        renderedCount: countBeforeAppend,
                    };
                }
                return { height: null, renderedCount };
            },
        });
        const seeMoreButton = createFakeLocator({ isVisible: () => false });

        const count = await scrollLoadPhase(page, seeMoreButton, {
            onProgress: (event) => progressEvents.push(event),
        });

        assert.equal(count, 70);
        assert.equal(renderedCount, 90);
        assert.deepEqual(progressEvents, [
            { type: 'jobs:loading', count: 60 },
            { type: 'jobs:loading', count: 70 },
        ]);
    });

    it('uses maxScrollAttempts as the final bound while duplicate raw rows keep arriving', async ({
        assert,
    }) => {
        let renderedCount = 1;
        let jobIdReads = 0;
        const progressEvents: ScrapeProgressEvent[] = [];
        const page = createScrollPage({
            jobIdReads: [
                ['job-0'],
                ['job-0', 'job-0'],
                ['job-0', 'job-0', 'job-0'],
            ],
            onJobIdRead: () => {
                jobIdReads += 1;
            },
            liInfoAt: (index) => {
                if (index < renderedCount) {
                    return { height: 0, renderedCount };
                }
                const countBeforeAppend = renderedCount;
                renderedCount += 1;
                return {
                    height: null,
                    renderedCount: countBeforeAppend,
                };
            },
        });
        const seeMoreButton = createFakeLocator({ isVisible: () => false });

        const count = await scrollLoadPhase(page, seeMoreButton, {
            maxScrollAttempts: 3,
            stableScrollsToStop: 1,
            onProgress: (event) => progressEvents.push(event),
        });

        assert.equal(count, 1);
        assert.equal(jobIdReads, 3);
        assert.equal(renderedCount, 4);
        assert.deepEqual(progressEvents, [
            { type: 'jobs:loading', count: 1 },
        ]);
    });

    it('stops after a caller-supplied maxScrollAttempts even when the job count keeps growing', async ({
        assert,
    }) => {
        let evaluateCalls = 0;
        const page = createFakePage({
            evaluate: (arg?: unknown) => {
                if (typeof arg === 'number') {
                    return { height: null, renderedCount: 0 }; // no <li>s to scroll — not under test here
                }
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

        // hide-sections's one-time call, plus exactly one collectJobListState()
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
            // Test-fixture closure modeling a stateful mock, not production
            // logic; its CRAP score is another estimated-0%-coverage
            // artifact of the fake being defined inside the test it serves.
            // fallow-ignore-next-line complexity
            liInfoAt: (index) => {
                const renderedCount = appended ? 3 : 2;
                if (index === 2) {
                    if (!appended) {
                        appended = true; // revisiting index 2 next time will find it
                        return { height: null, renderedCount };
                    }
                    return { height: 30, renderedCount: 3 };
                }
                return { height: liHeights[index] ?? null, renderedCount };
            },
        });
        const seeMoreButton = createFakeLocator({ isVisible: () => false });

        const count = await scrollLoadPhase(page, seeMoreButton, {
            stableScrollsToStop: 2,
        });

        assert.equal(count, 3);
    });

    it('resumes scrolling from the top once the live <li> count drops below where the phase had already scrolled to (LinkedIn re-serving a shorter page)', async ({
        assert,
    }) => {
        // 3 <li>s rendered up front (indices 0-2, each height 20). The
        // first time index 3 comes up empty, that's the ordinary "nothing
        // new yet" case. Only the *second* time index 3 is revisited does
        // the fake report a shrunk list (down to 1 item) — reproducing
        // collectJobListState.ts's documented re-serve scenario. Kept to a
        // handful of items so the real sleep(120) waits this exercises
        // stay bounded.
        const scrolledIndexes: number[] = [];
        let index3Queries = 0;
        const page = createScrollPage({
            jobIdReads: [[]],
            // Test-fixture closure modeling a stateful mock, not production
            // logic; its CRAP score is another estimated-0%-coverage
            // artifact of the fake being defined inside the test it serves.
            // fallow-ignore-next-line complexity
            liInfoAt: (index) => {
                scrolledIndexes.push(index);
                if (index === 3) {
                    index3Queries += 1;
                    return {
                        height: null,
                        renderedCount: index3Queries === 1 ? 3 : 1,
                    };
                }
                const renderedCount = index3Queries >= 2 ? 1 : 3;
                if (index < renderedCount) {
                    return { height: 20, renderedCount };
                }
                return { height: null, renderedCount };
            },
        });
        const seeMoreButton = createFakeLocator({ isVisible: () => false });

        await scrollLoadPhase(page, seeMoreButton);

        // Without the fix, once the list "shrinks", every later pass keeps
        // re-asking for the same stale index forever — index 0 is never
        // requested again. With the fix, the walk resets once the shrink
        // is detected, so index 0 shows up a second time.
        const firstIndexZero = scrolledIndexes.indexOf(0);
        const laterIndexZero = scrolledIndexes.indexOf(0, firstIndexZero + 1);
        assert.notEqual(
            laterIndexZero,
            -1,
            `expected index 0 to be requested again after the shrink, got sequence ${JSON.stringify(scrolledIndexes)}`,
        );
    });

    it('stops immediately when the signal is already aborted, without reading job IDs', async ({
        assert,
    }) => {
        let evaluateCalls = 0;
        const page = createFakePage({
            evaluate: (arg?: unknown) => {
                evaluateCalls += 1;
                if (typeof arg === 'number')
                    return { height: null, renderedCount: 0 };
                return ['a', 'b', 'c'];
            },
        });
        const seeMoreButton = createFakeLocator({ isVisible: () => false });
        const controller = new AbortController();
        controller.abort();

        const count = await scrollLoadPhase(page, seeMoreButton, {
            signal: controller.signal,
        });

        assert.equal(count, 0);
        // Only the one-time hide-sections call — the loop's own collectJobListState()
        // read never happens once the signal is already aborted.
        assert.equal(evaluateCalls, 1);
    });
});
