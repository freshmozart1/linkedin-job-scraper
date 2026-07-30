import type { Page } from 'playwright';
import { clearBlockingOverlays } from './clearBlockingOverlays';
import { findVisibleOverlay } from './findVisibleOverlay';

export async function dismissOverlayAfterClick(page: Page): Promise<void> {
    const dismissed = await clearBlockingOverlays(page, {
        timeoutMs: 8000,
        requiredConsecutiveClear: 2,
        pollIntervalMs: 200,
    });
    if (dismissed) return;
    const stillBlocked = (await findVisibleOverlay(page)) !== null;
    if (stillBlocked) {
        throw new Error(
            'Blocked by LinkedIn sign-in wall (could not dismiss dialog)',
        );
    }
}
