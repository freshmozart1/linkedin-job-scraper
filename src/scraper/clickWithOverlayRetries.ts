import type { Locator, Page } from 'playwright';
import type { JobBudget } from '../types';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import type { OverlayClearSettings } from './clearBlockingOverlays';
import { boundedClearTimeout, boundedTimeout } from './jobBudget';
import { sleep } from './sleep';

export interface ClickWithOverlayRetriesOptions {
    /** Click attempts before the last failure is rethrown; default 4. */
    maxAttempts?: number;
    /**
     * The caller's own tier policy (see OverlayClearSettings) plus the route
     * back to the run's progress stream. Without it a
     * `neutralizeStuckOverlay: false` set on ScraperOptions would apply only
     * to the single clear runScrape does after `page.goto`, and this site
     * would mutate the DOM anyway. The timings stay local — this site has its
     * own budget.
     */
    overlayClear?: OverlayClearSettings;
    /**
     * The job's wall-clock budget, when this click is part of one. Without it
     * the four attempts below can stack to ~34s on their local timeouts
     * alone; with it, each of those timeouts is clamped to what the job has
     * left and the retry loop stops as soon as there is nothing left to spend.
     */
    budget?: JobBudget;
}

// The sign-in wall can pop up *during* a click attempt (not just before it),
// e.g. triggered by the scrolling/loading that happened moments earlier. A
// single long click() with a fixed timeout can get stuck retrying against an
// overlay that appeared mid-wait, since nothing dismisses it while Playwright
// is inside its own click retry loop. So instead: short click attempts,
// actively clearing overlays between each one.
// The trailing parameters live in an options object rather than as further
// positionals: `budget` would have been a fifth, which was the tipping point.
// This function is internal (not re-exported from ./index), so only scrapeJob
// and clickLoadPhase had to move. The clear result itself is still ignored
// here — a blocked page shows up as the click failing, which this already
// retries.
//
// CRAP score here is driven by fallow's *estimated* (not instrumented)
// coverage defaulting to 0% for this function, not an actual
// untested-complexity risk — like pollForNewJobs/retryStaleJobs, this
// internal helper has no dedicated test file (see CLAUDE.md: only the
// exported subset is driven directly by tests), so the 0% estimate reflects
// this repo's testing boundary, not real risk. It is exercised through its
// only two callers, scrapeJob and clickLoadPhase. Cyclomatic 6 and cognitive
// 11 are both under threshold on their own; only CRAP trips it, at exactly
// the 6² + 6 that a 0% estimate produces.
// fallow-ignore-next-line complexity
export async function clickWithOverlayRetries(
    locator: Locator,
    page: Page,
    {
        maxAttempts = 4,
        overlayClear,
        budget,
    }: ClickWithOverlayRetriesOptions = {},
): Promise<void> {
    const pollIntervalMs = 200;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // `null` means the job has too little budget left for a clear to be
        // worth running — see boundedClearTimeout, which exists so a
        // near-spent budget can't drive clearBlockingOverlays straight to its
        // DOM-mutating neutralize tier. The click below is attempted anyway;
        // a page that really is blocked shows up as that click failing, which
        // this already retries.
        const clearTimeoutMs = boundedClearTimeout(
            budget,
            4000,
            pollIntervalMs,
        );
        if (clearTimeoutMs !== null)
            await clearBlockingOverlays(page, {
                timeoutMs: clearTimeoutMs,
                requiredConsecutiveClear: 2,
                pollIntervalMs,
                ...overlayClear,
            });
        try {
            await locator.click({ timeout: boundedTimeout(budget, 4000) });
            return;
        } catch (error) {
            // A spent budget (or an abort, which reads as no time left) stops
            // the ladder here rather than burning the remaining attempts on
            // 1ms clicks that cannot succeed — and reports it as the budget
            // failure it is. Rethrowing Playwright's own error instead would
            // record this job as `locator.click: Timeout 1ms exceeded`,
            // indistinguishable from a genuine click failure and not the
            // `Job exceeded per-job time budget of <n>ms` that
            // ScraperOptions.perJobTimeoutMs promises. `check()` always
            // throws once `remaining()` is 0, so the rethrow below stays
            // reachable only for a real failure.
            if (budget?.remaining() === 0) budget.check();
            if (attempt === maxAttempts) throw error;
            await sleep(boundedTimeout(budget, 500));
        }
    }
}
