import type { Page } from 'playwright';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import { findVisibleOverlay } from './findVisibleOverlay';

// The "sign in to view more jobs" nag can render asynchronously at any point
// (see src/scraper/index.ts's header comment), including in the gap after
// the text reads — re-check right before finishing this job so a
// late-appearing overlay doesn't silently taint the already-read
// company/description/tags data without being flagged. Returns whether the
// overlay was still visible at that point.
export async function checkForLateOverlay(page: Page): Promise<boolean> {
    const dismissed = await clearBlockingOverlays(page, {
        timeoutMs: 3000,
        requiredConsecutiveClear: 2,
        pollIntervalMs: 150,
    });
    return !dismissed && (await findVisibleOverlay(page)) !== null;
}
