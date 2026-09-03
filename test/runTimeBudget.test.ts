import { describe, it } from 'node:test';
import { createRunTimeBudget } from '../src';

/** Real elapsed time, deliberately: the budget is a real `AbortSignal.timeout`, not a mocked clock. */
function elapse(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createRunTimeBudget()', () => {
    describe('without a run budget', () => {
        it("hands back the caller's own signal untouched", ({ assert }) => {
            // A pass-through matters: a run that asked for no budget has to
            // behave exactly as it did before, same signal object included.
            const controller = new AbortController();

            const budget = createRunTimeBudget(undefined, controller.signal);

            assert.equal(budget.signal, controller.signal);
            assert.equal(budget.exceeded(), false);
        });

        it('hands back no signal at all when the caller passed none', ({
            assert,
        }) => {
            const budget = createRunTimeBudget();

            assert.equal(budget.signal, undefined);
            assert.equal(budget.exceeded(), false);
        });

        it('treats 0 and negative durations as no budget', ({ assert }) => {
            const controller = new AbortController();

            assert.equal(
                createRunTimeBudget(0, controller.signal).signal,
                controller.signal,
            );
            assert.equal(
                createRunTimeBudget(-1, controller.signal).signal,
                controller.signal,
            );
        });
    });

    describe('with a run budget', () => {
        it('aborts its signal, and reports exceeded, once the timer fires', async ({
            assert,
        }) => {
            const budget = createRunTimeBudget(5);
            assert.equal(budget.signal?.aborted, false);
            assert.equal(budget.exceeded(), false);

            await elapse(30);

            // The signal is the whole mechanism: every checkpoint that already
            // stops on `signal?.aborted` honours the run budget for free.
            assert.equal(budget.signal?.aborted, true);
            assert.equal(budget.exceeded(), true);
        });

        it("composes with the caller's signal so either one stops the run", ({
            assert,
        }) => {
            const controller = new AbortController();
            const budget = createRunTimeBudget(60000, controller.signal);
            assert.equal(budget.signal?.aborted, false);

            controller.abort();

            assert.equal(budget.signal?.aborted, true);
        });

        it('reports exceeded false for a plain caller abort, so runScrape still rejects', async ({
            assert,
        }) => {
            // This is the single distinction runScrape needs: an abort keeps
            // rejecting with ScrapeAbortedError, while an expired budget is
            // something the caller asked for and resolves instead.
            const controller = new AbortController();
            const budget = createRunTimeBudget(60000, controller.signal);

            controller.abort();
            await elapse(10);

            assert.equal(budget.signal?.aborted, true);
            assert.equal(budget.exceeded(), false);
        });

        it('reports exceeded once the timer fires even though the caller never aborted', async ({
            assert,
        }) => {
            const controller = new AbortController();
            const budget = createRunTimeBudget(5, controller.signal);

            await elapse(30);

            assert.equal(controller.signal.aborted, false);
            assert.equal(budget.exceeded(), true);
            assert.equal(budget.signal?.aborted, true);
        });
    });
});
