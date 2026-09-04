import { describe, it, TestContext } from 'node:test';
import { createJobBudget } from '../src';

/** Real elapsed time, deliberately: the budgets are wall-clock, so they are exercised against tiny real durations rather than a mocked clock. */
function elapse(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createJobBudget()', () => {
    describe('boundedTimeout()', () => {
        it('leaves a local cap alone while the budget has more time than it', ({
            assert,
        }) => {
            const budget = createJobBudget({ perJobTimeoutMs: 45000 });

            // The wait's own local budget still applies — the clamp can only
            // ever shorten a wait, never lengthen it.
            assert.equal(budget.boundedTimeout(1000), 1000);
            assert.equal(budget.boundedTimeout(4000), 4000);
        });

        it('clamps a local cap down to what is left of the budget', (t: TestContext) => {
            const budget = createJobBudget({ perJobTimeoutMs: 500 });

            const bounded = budget.boundedTimeout(8000);

            t.assert.ok(
                bounded > 0 && bounded <= 500,
                `expected the 8000ms cap to be clamped into (0, 500], got ${bounded}`,
            );
        });

        it('returns 1, never 0, once the budget is spent', async ({
            assert,
        }) => {
            const budget = createJobBudget({ perJobTimeoutMs: 1 });
            await elapse(20);

            // 0 is the one value that must never come back: Playwright reads
            // it as "no timeout", so a spent budget would become an unbounded
            // wait — the exact failure this whole feature exists to stop.
            assert.equal(budget.boundedTimeout(8000), 1);
            assert.equal(budget.remaining(), 0);
        });

        it('collapses to 1 as soon as the signal aborts, without waiting for the deadline', ({
            assert,
        }) => {
            const controller = new AbortController();
            const budget = createJobBudget({
                perJobTimeoutMs: 45000,
                signal: controller.signal,
            });
            assert.equal(budget.boundedTimeout(4000), 4000);

            controller.abort();

            assert.equal(budget.boundedTimeout(4000), 1);
            assert.equal(budget.remaining(), 0);
        });

        it('never throws, so a caller that swallows rejections cannot mistake it for a missing element', async ({
            assert,
        }) => {
            // trim() catches every rejection from its reads and reports the
            // missing-element fallback, so a clamp that threw would surface as
            // a misleading "No job title found for this list item".
            const controller = new AbortController();
            controller.abort();
            const budget = createJobBudget({
                perJobTimeoutMs: 1,
                signal: controller.signal,
            });
            await elapse(20);

            assert.doesNotThrow(() => budget.boundedTimeout(1000));
        });
    });

    describe('check()', () => {
        it('throws the per-job budget message, interpolating the configured value', async ({
            assert,
        }) => {
            const budget = createJobBudget({ perJobTimeoutMs: 5 });
            await elapse(25);

            assert.throws(
                () => budget.check(),
                /^Error: Job exceeded per-job time budget of 5ms$/,
            );
        });

        it('does not throw while the budget still has time left', ({
            assert,
        }) => {
            const budget = createJobBudget({ perJobTimeoutMs: 45000 });

            assert.doesNotThrow(() => budget.check());
        });

        it('throws the abort message when the signal aborted', ({ assert }) => {
            const controller = new AbortController();
            const budget = createJobBudget({
                perJobTimeoutMs: 45000,
                signal: controller.signal,
            });
            controller.abort();

            assert.throws(() => budget.check(), /^Error: Scrape aborted$/);
        });

        it('reports an abort in preference to an expired deadline when both are true', async ({
            assert,
        }) => {
            // A caller who asked to stop should read back what they asked for,
            // not a budget message that happened to expire in the same moment.
            const controller = new AbortController();
            const budget = createJobBudget({
                perJobTimeoutMs: 5,
                signal: controller.signal,
            });
            await elapse(25);
            controller.abort();

            assert.throws(() => budget.check(), /^Error: Scrape aborted$/);
        });
    });

    describe('a disabled budget', () => {
        it('treats 0 as "no timeout", following Playwright\'s own convention', async ({
            assert,
        }) => {
            const budget = createJobBudget({ perJobTimeoutMs: 0 });
            await elapse(20);

            assert.equal(budget.deadline, Infinity);
            assert.equal(budget.remaining(), Infinity);
            assert.equal(budget.boundedTimeout(8000), 8000);
            assert.doesNotThrow(() => budget.check());
        });

        it('treats a negative value the same way', async ({ assert }) => {
            const budget = createJobBudget({ perJobTimeoutMs: -1 });
            await elapse(20);

            assert.equal(budget.deadline, Infinity);
            assert.doesNotThrow(() => budget.check());
        });

        it('still collapses on an abort, since that is not about time', ({
            assert,
        }) => {
            const controller = new AbortController();
            const budget = createJobBudget({
                perJobTimeoutMs: 0,
                signal: controller.signal,
            });
            controller.abort();

            assert.equal(budget.remaining(), 0);
            assert.equal(budget.boundedTimeout(8000), 1);
            assert.throws(() => budget.check(), /^Error: Scrape aborted$/);
        });
    });

    it('defaults to a 45s budget when perJobTimeoutMs is omitted', (t: TestContext) => {
        const before = Date.now();

        const budget = createJobBudget({});

        t.assert.ok(
            budget.deadline >= before + 45000 &&
                budget.deadline <= Date.now() + 45000,
            `expected a deadline ~45s out, got ${budget.deadline - before}ms`,
        );
    });
});
