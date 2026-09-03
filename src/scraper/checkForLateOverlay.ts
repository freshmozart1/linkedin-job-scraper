import type { Page } from 'playwright';
import type { JobBudget } from '../types';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import type { OverlayClearSettings } from './clearBlockingOverlays';

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
    const { stillBlocking, neutralized, dismissed } =
        await clearBlockingOverlays(page, {
            timeoutMs: budget?.boundedTimeout(3000) ?? 3000,
            requiredConsecutiveClear: 2,
            pollIntervalMs: 150,
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
