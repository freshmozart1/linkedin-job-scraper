import type { RunTimeBudget } from '../types';

// The whole run's optional wall-clock budget, expressed as an AbortSignal
// rather than as a new parameter threaded through every phase.
//
// Every checkpoint in a run already stops on `signal?.aborted` —
// scrollLoadPhase, clickLoadPhase, pollForNewJobs, scrapeAllJobsOnce,
// retryStaleJobs — so composing the budget's timer into that one signal makes
// all of them honour it for free, with no new plumbing and no change to their
// contracts, which stay about *stopping early* rather than about any
// particular error type. runScrape remains the only place that tells the two
// apart, because only it can: `exceededReason()` reads the timer alone, so a
// plain caller abort still reports as an abort.
//
// AbortSignal.timeout / AbortSignal.any are both available on the >= 22.9.0
// Node this package requires, and the timer is unref'd, so an unfinished
// budget never holds the process open.
//
// CRAP score here is driven by fallow's *estimated* (not instrumented)
// coverage defaulting to 0% for this function, not an actual
// untested-complexity risk — cyclomatic 5 and cognitive 3 are both well under
// threshold, and only CRAP trips it, at exactly the 5² + 5 that a 0% estimate
// produces. Every branch below is driven by test/runTimeBudget.test.ts: the
// no-budget pass-through and each spelling of it (undefined, 0, negative,
// Infinity, NaN), the rounding and capping of a duration AbortSignal.timeout
// would reject outright, and both orderings exceededReason has to tell apart
// once the timer and the caller's own signal have fired.
// fallow-ignore-next-line complexity
export function createRunTimeBudget(
    maxRunDurationMs?: number,
    signal?: AbortSignal,
): RunTimeBudget {
    // No budget asked for: a pure pass-through, so a run without one behaves
    // exactly as it did before — same signal object, `exceeded()` never true.
    //
    // `Infinity` and `NaN` take this branch too, and deliberately:
    // `Infinity` is the natural way to say "no limit", and neither is a
    // duration `AbortSignal.timeout` will accept (see below), so rejecting
    // the whole run over them would be a worse answer than the one the
    // caller plainly meant.
    if (
        maxRunDurationMs === undefined ||
        !Number.isFinite(maxRunDurationMs) ||
        maxRunDurationMs <= 0
    )
        return { signal, exceededReason: () => null };

    // AbortSignal.timeout validates its delay as a uint32 and throws
    // ERR_OUT_OF_RANGE for a fraction (`minutes * 60 * 1000` off a `2.5`) or
    // anything past 2**31-1 — synchronously, before `chromium.launch`, as a
    // raw Node error with nothing in it naming `maxRunDurationMs`. Rounding
    // and capping keeps that arithmetic from rejecting the run.
    const timer = AbortSignal.timeout(
        Math.min(Math.floor(maxRunDurationMs), 2 ** 31 - 1),
    );
    return {
        signal: signal ? AbortSignal.any([signal, timer]) : timer,
        // The caller's own signal is checked first, and returning `null` for
        // it is what keeps a caller abort reported as an abort even though
        // the two signals are composed into one by the time anything
        // downstream sees them. Only this function still holds them apart,
        // which is why the ordering lives here rather than being re-derived
        // by runScrape and createJobBudget separately.
        exceededReason: () =>
            !signal?.aborted && timer.aborted
                ? `Run exceeded its ${maxRunDurationMs}ms time budget`
                : null,
    };
}
