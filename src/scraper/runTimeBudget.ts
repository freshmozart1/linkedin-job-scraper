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
// apart, because only it can: `exceeded()` reads the timer alone, so a plain
// caller abort still reports as an abort.
//
// AbortSignal.timeout / AbortSignal.any are both available on the >= 22.9.0
// Node this package requires, and the timer is unref'd, so an unfinished
// budget never holds the process open.
export function createRunTimeBudget(
    maxRunDurationMs?: number,
    signal?: AbortSignal,
): RunTimeBudget {
    // No budget asked for: a pure pass-through, so a run without one behaves
    // exactly as it did before — same signal object, `exceeded()` never true.
    if (maxRunDurationMs === undefined || maxRunDurationMs <= 0)
        return { signal, exceeded: () => false };

    const timer = AbortSignal.timeout(maxRunDurationMs);
    return {
        signal: signal ? AbortSignal.any([signal, timer]) : timer,
        exceeded: () => timer.aborted,
    };
}
