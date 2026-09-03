import type { Locator, Page } from 'playwright';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import type { OverlayClearSettings } from './clearBlockingOverlays';
import { sleep } from './sleep';

// The sign-in wall can pop up *during* a click attempt (not just before it),
// e.g. triggered by the scrolling/loading that happened moments earlier. A
// single long click() with a fixed timeout can get stuck retrying against an
// overlay that appeared mid-wait, since nothing dismisses it while Playwright
// is inside its own click retry loop. So instead: short click attempts,
// actively clearing overlays between each one.
// `overlayClear` is a further optional positional parameter rather than a
// full options object so every existing call site keeps working unchanged. It
// carries the caller's own tier policy (see OverlayClearSettings) plus the
// route back to the run's progress stream, since without it a
// `neutralizeStuckOverlay: false` set on ScraperOptions would apply only to
// the one clear runScrape does after `page.goto` and this site would mutate
// the DOM anyway. The timings stay local — this site has its own budget. The
// clear result itself is still ignored here — a blocked page shows up as the
// click failing, which this already retries.
export async function clickWithOverlayRetries(
    locator: Locator,
    page: Page,
    maxAttempts = 4,
    overlayClear?: OverlayClearSettings,
): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await clearBlockingOverlays(page, {
            timeoutMs: 4000,
            requiredConsecutiveClear: 2,
            pollIntervalMs: 200,
            ...overlayClear,
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
