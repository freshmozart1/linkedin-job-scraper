import type { Page } from 'playwright';
import type { ScrapeProgressEvent } from '../types';
import { clearBlockingOverlays } from './clearBlockingOverlays';

// The "sign in to view more jobs" nag can render asynchronously at any point
// (see src/scraper/index.ts's header comment), including in the gap after
// the text reads — re-check right before finishing this job so a
// late-appearing overlay doesn't silently taint the already-read
// company/description/tags data without being flagged. Returns whether the
// overlay was still visible at that point.
export async function checkForLateOverlay(
    page: Page,
    onProgress?: (event: ScrapeProgressEvent) => void,
): Promise<boolean> {
    const { stillBlocking, neutralized } = await clearBlockingOverlays(page, {
        timeoutMs: 3000,
        requiredConsecutiveClear: 2,
        pollIntervalMs: 150,
        onProgress,
    });
    // `neutralized` counts as a late overlay even though the page is
    // clickable again afterwards, and that is deliberate. This flag exists
    // to say "an overlay was over the pane around the moment its data was
    // read", not "the page is blocked now" — and an overlay stubborn enough
    // to need forcing open is the strongest version of that. Without it,
    // `lateOverlayDetected` would go dead the moment the new neutralize tier
    // started clearing every stuck overlay, silently costing those jobs the
    // one retry `retryStaleJobs` gives a stale result.
    return stillBlocking || neutralized;
}
