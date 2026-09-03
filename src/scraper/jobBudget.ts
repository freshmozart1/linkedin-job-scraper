import type { JobBudget } from '../types';

/**
 * Default wall-clock budget for one job, in milliseconds. Sized against the
 * measured worst case for a single `scrapeJob` (see GitHub issue #28): the
 * per-job waits stack to over 100 seconds, and the great majority of that is
 * only ever spent by a job that is already blocked. 45s leaves an honest job
 * — including a slow company-page lookup — plenty of room while cutting a
 * stuck one off well before it can stall a whole run.
 */
const DEFAULT_PER_JOB_TIMEOUT_MS = 45000;

// One job's wall-clock deadline, plus the run's abort signal, in a single
// object that every wait below scrapeJob observes.
//
// Deliberately not a race between scrapeJob and a timer: Playwright respects
// the timeouts it is handed, so clamping each individual wait bounds real
// elapsed time *and* leaves no orphaned browser work running behind a promise
// that has already resolved. Threading the signal in here at the same time is
// what makes an abort land inside a slow job within seconds instead of only
// between jobs.
export function createJobBudget(options: {
    perJobTimeoutMs?: number;
    /** The composed run signal (caller abort + any run-time budget); see createRunTimeBudget. */
    signal?: AbortSignal;
}): JobBudget {
    const { perJobTimeoutMs = DEFAULT_PER_JOB_TIMEOUT_MS, signal } = options;
    // `0` or negative disables the budget, following Playwright's own
    // convention for its timeouts rather than inventing a second one.
    const budgeted = perJobTimeoutMs > 0;
    const deadline = budgeted ? Date.now() + perJobTimeoutMs : Infinity;

    function remaining(): number {
        // An aborted signal is treated as no time left at all, so every
        // clamped wait below collapses without each call site needing its
        // own signal check.
        if (signal?.aborted) return 0;
        if (!budgeted) return Infinity;
        return Math.max(0, deadline - Date.now());
    }

    return {
        deadline,
        remaining,
        boundedTimeout(cap: number): number {
            const left = remaining();
            if (left === Infinity) return cap;
            // Never above the cap (the wait's own local budget still
            // applies), and never `0` — Playwright reads `0` as "no
            // timeout", the exact opposite of what a spent budget means. A
            // spent budget yields `1`, which collapses the wait immediately.
            //
            // This never throws, and that is load-bearing: `trim` swallows
            // every rejection from its reads, so a clamp that threw would be
            // laundered into a misleading "No job title found for this list
            // item". Stopping the job is `check`'s job, at a step boundary
            // where the thrown message survives into the failed result.
            return Math.max(1, Math.min(cap, left));
        },
        check(): void {
            // Abort first, deliberately: when a caller asked to stop and the
            // deadline happened to pass in the same moment, the caller should
            // read back what they asked for, not a budget message.
            if (signal?.aborted) throw new Error('Scrape aborted');
            // `Date.now() >= Infinity` is false, so an unbudgeted job never
            // trips this and needs no separate guard.
            if (Date.now() >= deadline)
                throw new Error(
                    `Job exceeded per-job time budget of ${perJobTimeoutMs}ms`,
                );
        },
    };
}
