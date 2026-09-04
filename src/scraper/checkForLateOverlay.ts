import type { Page } from 'playwright';
import type { JobBudget } from '../types';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import type { OverlayClearSettings } from './clearBlockingOverlays';
import { boundedClearTimeout } from './jobBudget';

// The "sign in to view more jobs" nag can render asynchronously at any point
// (see src/scraper/index.ts's header comment), including in the gap after
// the text reads — re-check right before finishing this job so a
// late-appearing overlay doesn't silently taint the already-read
// company/description/tags data without being flagged. Returns whether the
// overlay was still visible at that point. `budget` clamps this check's own
// 3s deadline to what the job has left, so the last step of a job that is
// already out of time cannot add three more seconds to it.
export async function checkForLateOverlay(
    page: Page,
    overlayClear?: OverlayClearSettings,
    budget?: JobBudget,
): Promise<boolean> {
    const pollIntervalMs = 150;
    const timeoutMs = boundedClearTimeout(budget, 3000, pollIntervalMs);
    // Too little budget left to run a real clear, so this reports what it
    // actually knows: nothing. `false` is deliberately the answer rather than
    // a clamped clear's — a clear squeezed below one poll interval escalates
    // to the neutralize tier on its first round and then reports
    // `neutralized: true`, which would flag the job stale and buy it a full
    // re-scrape in retryStaleJobs. Spending an extra whole job on a job that
    // just ran out of time is the opposite of what the budget is for.
    if (timeoutMs === null) return false;
    const { stillBlocking, neutralized, dismissed } =
        await clearBlockingOverlays(page, {
            timeoutMs,
            requiredConsecutiveClear: 2,
            pollIntervalMs,
            ...overlayClear,
        });
    // Every one of the three counts, and that is deliberate. This flag exists
    // to say "an overlay was over the pane around the moment its data was
    // read", not "the page is blocked now" — so *finding* an overlay here is
    // the signal, and how it was eventually got rid of is beside the point.
    //
    // Reading only `stillBlocking` would make the flag go dead exactly as the
    // escalation ladder got better at its job: an overlay the new tiers
    // close but the old single name-matched click could not would report a
    // clean page and quietly cost that job the one
    // retry `retryStaleJobs` gives a stale result — while the tainted read
    // was kept as trustworthy. `neutralized` has the same problem for an
    // overlay stubborn enough to need forcing open.
    return stillBlocking || neutralized || dismissed;
}
