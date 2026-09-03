import type { JobBudget, RunTimeBudget } from '../types';

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
    /**
     * The run's own budget, purely so `check` can name what stopped a job it
     * caught in flight. `signal` alone cannot: `createRunTimeBudget` composes
     * the caller's abort and the `maxRunDurationMs` timer into one signal, so
     * without this a run that simply ran out of time would report every
     * in-flight job as `Scrape aborted` — telling a consumer the caller
     * cancelled a run the caller never touched, in a string that ends up
     * persisted on the `FailedJobResult`.
     */
    runTimeBudget?: RunTimeBudget;
}): JobBudget {
    const {
        perJobTimeoutMs = DEFAULT_PER_JOB_TIMEOUT_MS,
        signal,
        runTimeBudget,
    } = options;
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
        // CRAP score here is driven by fallow's *estimated* (not
        // instrumented) coverage defaulting to 0% for this function, not an
        // actual untested-complexity risk — cyclomatic 5 and cognitive 3 are
        // both well under threshold, and only CRAP trips it, at exactly the
        // 5² + 5 that a 0% estimate produces. Each of the three guards below
        // is driven by a test: test/jobBudget.test.ts covers the spent
        // deadline, the abort, and their precedence, and
        // test/scrapeJob.test.ts covers the runTimeBudget branch that reports
        // a spent *run* instead of a spent job.
        // fallow-ignore-next-line complexity
        check(): void {
            // Whatever stopped the *run* comes first, deliberately: a run
            // that is already over cannot be rescued by finishing the job in
            // front of it, so blaming this job's own deadline would point a
            // consumer at the wrong knob. `exceededReason` already resolves
            // the caller-abort-wins ordering internally, and returns null for
            // a plain abort — which the next line then reports.
            const runReason = runTimeBudget?.exceededReason();
            if (runReason) throw new Error(runReason);
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

/**
 * `budget?.boundedTimeout(cap) ?? cap`, stated once instead of at every wait
 * in the per-job path. Spelling it out inline repeated each cap literal twice
 * per site, so a changed cap had to be edited in two places and a mismatch
 * was silent.
 */
export function boundedTimeout(
    budget: JobBudget | undefined,
    cap: number,
): number {
    return budget?.boundedTimeout(cap) ?? cap;
}

/**
 * The clamped `timeoutMs` for an overlay clear, or `null` when the job has
 * too little left for one to be worth running.
 *
 * An overlay clear is not an ordinary wait. `clearBlockingOverlays` escalates
 * to its DOM-mutating neutralize tier as soon as
 * `deadline - now <= pollIntervalMs`, so a `timeoutMs` clamped below one poll
 * interval makes a low-budget job skip the polite dismiss/Escape tiers and
 * mutate the shared search page on its very first round — reporting
 * `overlay:undismissed { neutralized: true }` while doing it, and leaving
 * that mutation in place for every later job in the run. Worse, a clear that
 * degrades to a single probe answers `stillBlocking` from one look at a page
 * it never tried to unblock, which `dismissOverlayAfterClick` would then
 * report as a LinkedIn sign-in wall and `checkForLateOverlay` as a stale
 * result worth a full re-scrape — both of them blaming the site for the job
 * simply running out of time.
 *
 * Below the floor the clear is skipped outright instead, leaving the job to
 * stop at the caller's next `budget.check()` with the budget's own message.
 */
export function boundedClearTimeout(
    budget: JobBudget | undefined,
    cap: number,
    pollIntervalMs: number,
): number | null {
    const bounded = boundedTimeout(budget, cap);
    return bounded > pollIntervalMs ? bounded : null;
}
