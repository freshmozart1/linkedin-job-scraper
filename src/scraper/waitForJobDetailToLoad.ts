import type { Page } from 'playwright';

// The detail pane re-renders client-side after a click; networkidle alone
// doesn't guarantee that DOM patch has landed (it only tracks network quiet
// time), so wait for the detail pane's own title link to actually reference
// this job's ID before trusting its content.
export async function waitForJobDetailToLoad(
    page: Page,
    sourceJobId: string | null,
): Promise<void> {
    if (sourceJobId) {
        await page
            .locator(`a[href*="topcard-title"][href*="-${sourceJobId}"]`)
            .first()
            .waitFor({ state: 'visible', timeout: 8000 })
            .catch(() => {});
    }

    await page
        .waitForLoadState('networkidle', { timeout: 5000 })
        .catch(() => {});
}
