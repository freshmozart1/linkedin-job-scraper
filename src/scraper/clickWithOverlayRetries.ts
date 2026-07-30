import type { Locator, Page } from 'playwright';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import { sleep } from './sleep';

// The sign-in wall can pop up *during* a click attempt (not just before it),
// e.g. triggered by the scrolling/loading that happened moments earlier. A
// single long click() with a fixed timeout can get stuck retrying against an
// overlay that appeared mid-wait, since nothing dismisses it while Playwright
// is inside its own click retry loop. So instead: short click attempts,
// actively clearing overlays between each one.
export async function clickWithOverlayRetries(
    locator: Locator,
    page: Page,
    maxAttempts = 4,
): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await clearBlockingOverlays(page, {
            timeoutMs: 4000,
            requiredConsecutiveClear: 2,
            pollIntervalMs: 200,
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
