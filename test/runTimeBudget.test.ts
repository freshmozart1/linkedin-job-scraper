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
            assert.equal(budget.exceededReason(), null);
        });

        it('hands back no signal at all when the caller passed none', ({
            assert,
        }) => {
            const budget = createRunTimeBudget();

            assert.equal(budget.signal, undefined);
            assert.equal(budget.exceededReason(), null);
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

        it('treats Infinity and NaN as no budget rather than rejecting the run', ({
            assert,
        }) => {
            // `AbortSignal.timeout` validates its delay as a uint32 and throws
            // ERR_OUT_OF_RANGE for either — synchronously, before
            // `chromium.launch`, as a raw Node error naming only "delay".
            // `Infinity` is also the natural way to ask for no limit.
            const controller = new AbortController();

            assert.equal(
                createRunTimeBudget(Infinity, controller.signal).signal,
                controller.signal,
            );
            assert.equal(
                createRunTimeBudget(NaN, controller.signal).signal,
                controller.signal,
            );
        });
    });

    describe('with a duration AbortSignal.timeout would reject', () => {
        it('rounds a fractional duration instead of throwing ERR_OUT_OF_RANGE', ({
            assert,
        }) => {
            // e.g. a caller's `minutes * 60 * 1000` off a config value of 2.5.
            const budget = createRunTimeBudget(1500.5);

            assert.equal(budget.signal?.aborted, false);
            assert.equal(budget.exceededReason(), null);
        });

        it('caps a duration past the timer range instead of throwing', ({
            assert,
        }) => {
            const budget = createRunTimeBudget(5e9);

            assert.equal(budget.signal?.aborted, false);
            assert.equal(budget.exceededReason(), null);
        });
    });

    describe('with a run budget', () => {
        it('aborts its signal, and names the budget, once the timer fires', async ({
            assert,
        }) => {
            const budget = createRunTimeBudget(5);
            assert.equal(budget.signal?.aborted, false);
            assert.equal(budget.exceededReason(), null);

            await elapse(30);

            // The signal is the whole mechanism: every checkpoint that already
            // stops on `signal?.aborted` honours the run budget for free.
            assert.equal(budget.signal?.aborted, true);
            // The duration is named verbatim, not the rounded/capped value
            // handed to AbortSignal.timeout — the caller should read back what
            // they configured.
            assert.equal(
                budget.exceededReason(),
                'Run exceeded its 5ms time budget',
            );
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

        it('reports no reason for a plain caller abort, so runScrape still rejects', async ({
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
            assert.equal(budget.exceededReason(), null);
        });

        it("keeps reporting the caller's abort even after the timer also fires", async ({
            assert,
        }) => {
            // Both signals are composed into one by the time anything
            // downstream sees them, so this ordering has to live here: a
            // caller who asked to stop reads that back rather than a budget
            // message that expired in the same window.
            const controller = new AbortController();
            const budget = createRunTimeBudget(5, controller.signal);

            controller.abort();
            await elapse(30);

            assert.equal(budget.exceededReason(), null);
        });

        it('names the budget once the timer fires even though the caller never aborted', async ({
            assert,
        }) => {
            const controller = new AbortController();
            const budget = createRunTimeBudget(5, controller.signal);

            await elapse(30);

            assert.equal(controller.signal.aborted, false);
            assert.equal(
                budget.exceededReason(),
                'Run exceeded its 5ms time budget',
            );
            assert.equal(budget.signal?.aborted, true);
        });
    });
});
