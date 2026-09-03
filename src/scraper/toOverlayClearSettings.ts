import type { ScraperOptions } from '../types';
import type { OverlayClearSettings } from './clearBlockingOverlays';

// The caller's overlay tier policy, narrowed to the part that travels.
//
// Deliberately not `{...scraperOptions?.overlayClear}`: the three timing
// fields (timeoutMs / pollIntervalMs / requiredConsecutiveClear) must NOT be
// carried. Each downstream clear site has its own budget for its own point in
// the run — 3000ms inside checkForLateOverlay against 15000ms after
// `page.goto` — and spreading the caller's whole object would overwrite those
// with a number chosen for a different site entirely.
//
// It exists as a function because runScrape and loadAllJobs both need the
// same narrowing, and were each spelling it out field by field. A third tier
// option added to ScraperOptions.overlayClear would have had to be remembered
// in both places, and forgetting one would leave the load phase quietly
// running a different policy than the per-job sites — the exact drift
// OverlayClearSettings was introduced to prevent.
//
// `onProgress` is not part of this: it is added by whichever site owns the
// run's callback (clickLoadPhase, scrapeJobAndRecord), not carried in the
// policy object.
export function toOverlayClearSettings(
    scraperOptions: ScraperOptions | undefined,
): Omit<OverlayClearSettings, 'onProgress'> {
    return {
        maxDismissAttempts: scraperOptions?.overlayClear?.maxDismissAttempts,
        neutralizeStuckOverlay:
            scraperOptions?.overlayClear?.neutralizeStuckOverlay,
    };
}
