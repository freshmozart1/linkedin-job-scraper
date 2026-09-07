import type { Page } from 'playwright';
import type { JobBudget } from '../types';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import type { OverlayClearSettings } from './clearBlockingOverlays';
import { describeOverlayDiagnostics } from './describeOverlayDiagnostics';
import { boundedClearTimeout } from './jobBudget';
import type { StaleDiagnosticsRecorder } from './createStaleDiagnostics';
import { recordOverlayCheck } from './recordOverlayCheck';

// `budget` clamps the 8s local deadline to what the job has left. Nothing
// inside clearBlockingOverlays needed changing for that: it already ends on
// its own `timeoutMs` deadline, so clamping the value handed to it at each
// call site is the whole integration.
//
// `diagnostics` (optional trailing parameter, so omitting it leaves this
// byte-identical) records the `{ dismissed, neutralized }` this function
// already receives and currently discards. GitHub issue #29 asks for overlay
// state across the *whole* job rather than only at checkForLateOverlay time,
// and this is the one point in a job where an overlay can appear, be dealt
// with, and be gone again before anything else looks — invisible to every
// later check.
export async function dismissOverlayAfterClick(
    page: Page,
    overlayClear?: OverlayClearSettings,
    budget?: JobBudget,
    diagnostics?: StaleDiagnosticsRecorder,
): Promise<void> {
    const pollIntervalMs = 200;
    const timeoutMs = boundedClearTimeout(budget, 8000, pollIntervalMs);
    const startedAt = Date.now();
    // Too little budget left for a real clear. Returning is the honest
    // answer: a clamped clear degrades to a single probe that never attempts
    // a dismissal, so its `stillBlocking` would blame LinkedIn's sign-in wall
    // — in the very error string GitHub issue #27 exists to make trustworthy
    // — for a job that simply ran out of time. scrapeJob's next
    // `budget.check()` stops the job with the budget's own message instead.
    //
    // The skipped check is still recorded so it cannot be confused with a
    // clear that ran and found no overlay.
    if (timeoutMs === null) {
        recordOverlayCheck(diagnostics, { phase: 'post-click', startedAt });
        return;
    }
    const result = await clearBlockingOverlays(page, {
        timeoutMs,
        requiredConsecutiveClear: 2,
        pollIntervalMs,
        ...overlayClear,
    });
    recordOverlayCheck(diagnostics, {
        phase: 'post-click',
        startedAt,
        result,
    });
    const { stillBlocking, diagnostics: overlayInfo } = result;
    // Recorded before the throw below, not after the early return, so the
    // blocked-by-sign-in-wall case — the most interesting one — is the one
    // case that definitely keeps its record.
    // `stillBlocking`, not `!dismissed`: an overlay that had to be
    // neutralized was never "dismissed", yet the page is clickable and this
    // job should proceed. Throwing on `!dismissed` would fail every job the
    // new neutralize tier just rescued. This also replaces the second
    // findVisibleOverlay call that used to live here — clearBlockingOverlays
    // already answered the question authoritatively.
    if (!stillBlocking) return;
    // The diagnostics ride along in the message so they survive into the
    // FailedJobResult's `error` string, not just the progress stream: a run
    // whose consumer ignores progress events still ends up with a record of
    // what the overlay was, which is exactly what GitHub issue #27 lacked.
    throw new Error(
        'Blocked by LinkedIn sign-in wall (could not dismiss dialog): ' +
            describeOverlayDiagnostics(overlayInfo),
    );
}
