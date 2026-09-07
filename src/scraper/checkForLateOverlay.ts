import type { Page } from 'playwright';
import type { JobBudget, OverlayDiagnostics } from '../types';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import type { OverlayClearSettings } from './clearBlockingOverlays';
import { boundedClearTimeout } from './jobBudget';
import type { StaleDiagnosticsRecorder } from './createStaleDiagnostics';
import { recordOverlayCheck } from './recordOverlayCheck';

/**
 * What the late-overlay check saw, rather than the bare boolean it used to
 * return.
 *
 * `detected` is the unchanged `lateOverlayDetected` flag and the only field
 * `readJobDetailPane` acts on; the other three are what it is *made of*.
 * GitHub issue #29 asks a consumer to be able to tell which condition caused
 * a suspect result without reading scraper logs, and `detected` alone cannot
 * say whether an overlay was politely dismissed, forcibly neutralized, or
 * still sitting over the pane when its data was read — three very different
 * findings that the flag deliberately folds into one.
 *
 * This function is internal (not re-exported from ./index), so widening its
 * return is not a public signature change.
 */
export interface LateOverlayCheck {
    /** `stillBlocking || neutralized || dismissed` — the `lateOverlayDetected` flag, unchanged. */
    detected: boolean;
    dismissed: boolean;
    neutralized: boolean;
    stillBlocking: boolean;
    /** What was read off the overlay, when there was one; `null` otherwise. */
    diagnostics: OverlayDiagnostics | null;
    observed: boolean;
    diagnosticsReadFailed: boolean;
}

// The "sign in to view more jobs" nag can render asynchronously at any point
// (see src/scraper/index.ts's header comment), including in the gap after
// the text reads — re-check right before finishing this job so a
// late-appearing overlay doesn't silently taint the already-read
// company/description/tags data without being flagged. Reports whether the
// overlay was still visible at that point, and what became of it. `budget`
// clamps this check's own 3s deadline to what the job has left, so the last
// step of a job that is already out of time cannot add three more seconds to
// it.
export async function checkForLateOverlay(
    page: Page,
    overlayClear?: OverlayClearSettings,
    budget?: JobBudget,
    diagnosticsRecorder?: StaleDiagnosticsRecorder,
): Promise<LateOverlayCheck> {
    const pollIntervalMs = 150;
    const timeoutMs = boundedClearTimeout(budget, 3000, pollIntervalMs);
    const startedAt = Date.now();
    // Too little budget left to run a real clear, so this reports what it
    // actually knows: nothing. `detected: false` is deliberately the answer
    // rather than a clamped clear's — a clear squeezed below one poll
    // interval escalates to the neutralize tier on its first round and then
    // reports `neutralized: true`, which would flag the job stale and buy it
    // a full re-scrape in retryStaleJobs. Spending an extra whole job on a
    // job that just ran out of time is the opposite of what the budget is
    // for. Every field is false/null here so the caller can tell this from a
    // clear that ran and found nothing; the overlay timeline distinguishes
    // the two with its `ran` field.
    if (timeoutMs === null) {
        recordOverlayCheck(diagnosticsRecorder, { phase: 'late', startedAt });
        return {
            detected: false,
            observed: false,
            dismissed: false,
            neutralized: false,
            stillBlocking: false,
            diagnostics: null,
            diagnosticsReadFailed: false,
        };
    }
    const result = await clearBlockingOverlays(page, {
            timeoutMs,
            requiredConsecutiveClear: 2,
            pollIntervalMs,
            ...overlayClear,
        });
    recordOverlayCheck(diagnosticsRecorder, {
        phase: 'late',
        startedAt,
        result,
    });
    const {
        observed,
        stillBlocking,
        neutralized,
        dismissed,
        diagnostics,
        diagnosticsReadFailed,
    } = result;
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
    return {
        detected: stillBlocking || neutralized || dismissed,
        observed,
        dismissed,
        neutralized,
        stillBlocking,
        diagnostics,
        diagnosticsReadFailed,
    };
}
