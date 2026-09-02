import type { Locator, Page } from 'playwright';
import type { ScrapeProgressEvent } from '../types';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import { sleep } from './sleep';

// The sign-in wall can pop up *during* a click attempt (not just before it),
// e.g. triggered by the scrolling/loading that happened moments earlier. A
// single long click() with a fixed timeout can get stuck retrying against an
// overlay that appeared mid-wait, since nothing dismisses it while Playwright
// is inside its own click retry loop. So instead: short click attempts,
// actively clearing overlays between each one.
// `onProgress` is a further optional positional parameter rather than an
// options object so every existing call site keeps working unchanged; it is
// only threaded through so clearBlockingOverlays can report an overlay it
// could not dismiss. The clear result itself is still ignored here — a
// blocked page shows up as the click failing, which this already retries.
export async function clickWithOverlayRetries(
    locator: Locator,
    page: Page,
    maxAttempts = 4,
    onProgress?: (event: ScrapeProgressEvent) => void,
): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await clearBlockingOverlays(page, {
            timeoutMs: 4000,
            requiredConsecutiveClear: 2,
            pollIntervalMs: 200,
            onProgress,
        });
        try {
            await locator.click({ timeout: 4000 });
            return;
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            await sleep(500);
        }
    }
}
