import type { Locator, Page } from 'playwright';
import type { JobBudget } from '../types';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import type { OverlayClearSettings } from './clearBlockingOverlays';
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
export async function clickWithOverlayRetries(
    locator: Locator,
    page: Page,
    {
        maxAttempts = 4,
        overlayClear,
        budget,
    }: ClickWithOverlayRetriesOptions = {},
): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await clearBlockingOverlays(page, {
            timeoutMs: budget?.boundedTimeout(4000) ?? 4000,
            requiredConsecutiveClear: 2,
            pollIntervalMs: 200,
            ...overlayClear,
        });
        try {
            await locator.click({
                timeout: budget?.boundedTimeout(4000) ?? 4000,
            });
            return;
        } catch (error) {
            // A spent budget (or an abort, which reads as no time left)
            // stops the ladder here rather than burning the remaining
            // attempts on 1ms clicks that cannot succeed. The failure is
            // rethrown either way, so scrapeJob's catch still records the
            // real Playwright error for this job.
            if (attempt === maxAttempts || budget?.remaining() === 0)
                throw error;
            await sleep(budget?.boundedTimeout(500) ?? 500);
        }
    }
}
