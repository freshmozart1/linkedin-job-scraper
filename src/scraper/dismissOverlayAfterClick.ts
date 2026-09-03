import type { Page } from 'playwright';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import type { OverlayClearSettings } from './clearBlockingOverlays';
import { describeOverlayDiagnostics } from './describeOverlayDiagnostics';

export async function dismissOverlayAfterClick(
    page: Page,
    overlayClear?: OverlayClearSettings,
): Promise<void> {
    const { stillBlocking, diagnostics } = await clearBlockingOverlays(page, {
        timeoutMs: 8000,
        requiredConsecutiveClear: 2,
        pollIntervalMs: 200,
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
