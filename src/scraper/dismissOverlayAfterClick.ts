import type { Page } from 'playwright';
import type { JobBudget } from '../types';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import type { OverlayClearSettings } from './clearBlockingOverlays';
import { describeOverlayDiagnostics } from './describeOverlayDiagnostics';
import { boundedClearTimeout } from './jobBudget';

// `budget` clamps the 8s local deadline to what the job has left. Nothing
// inside clearBlockingOverlays needed changing for that: it already ends on
// its own `timeoutMs` deadline, so clamping the value handed to it at each
// call site is the whole integration.
export async function dismissOverlayAfterClick(
    page: Page,
    overlayClear?: OverlayClearSettings,
    budget?: JobBudget,
): Promise<void> {
    const pollIntervalMs = 200;
    const timeoutMs = boundedClearTimeout(budget, 8000, pollIntervalMs);
    // Too little budget left for a real clear. Returning is the honest
    // answer: a clamped clear degrades to a single probe that never attempts
    // a dismissal, so its `stillBlocking` would blame LinkedIn's sign-in wall
    // — in the very error string GitHub issue #27 exists to make trustworthy
    // — for a job that simply ran out of time. scrapeJob's next
    // `budget.check()` stops the job with the budget's own message instead.
    if (timeoutMs === null) return;
    const { stillBlocking, diagnostics } = await clearBlockingOverlays(page, {
        timeoutMs,
        requiredConsecutiveClear: 2,
        pollIntervalMs,
        ...overlayClear,
    });
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
            describeOverlayDiagnostics(diagnostics),
    );
}
