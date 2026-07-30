import type { Page } from 'playwright';
import { findVisibleOverlay } from './findVisibleOverlay';
import { sleep } from './sleep';

interface OverlayClearOptions {
    timeoutMs?: number;
    pollIntervalMs?: number;
    requiredConsecutiveClear?: number;
}

export async function clearBlockingOverlays(
    page: Page,
    {
        timeoutMs = 15000,
        pollIntervalMs = 250,
        requiredConsecutiveClear = 4,
    }: OverlayClearOptions = {},
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let dismissedAny = false;
    let consecutiveNotVisible = 0;

    while (Date.now() < deadline) {
        const overlay = await findVisibleOverlay(page);

        if (!overlay) {
            consecutiveNotVisible += 1;
            if (consecutiveNotVisible >= requiredConsecutiveClear) break;
            await sleep(pollIntervalMs);
            continue;
        }

        consecutiveNotVisible = 0;
        const button = overlay
            .getByRole('button', { name: /reject|dismiss|accept/i })
            .first();
        try {
            await button.click({ timeout: 2000 });
            dismissedAny = true;
            await overlay
                .waitFor({ state: 'hidden', timeout: 3000 })
                .catch(() => {});
        } catch {
            await sleep(pollIntervalMs);
        }
    }

    return dismissedAny;
}
