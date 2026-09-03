import type { Page } from 'playwright';
import type { JobBudget } from '../types';
import { DETAIL_TITLE_LINK_SELECTOR } from '../selectors';

// The detail pane re-renders client-side after a click; networkidle alone
// doesn't guarantee that DOM patch has landed (it only tracks network quiet
// time), so wait for the detail pane's own title link to actually reference
// this job's ID before trusting its content.
//
// Both waits are best-effort already (`.catch(() => {})`), so clamping them
// to the job's remaining budget only ever makes this give up sooner and hand
// the — possibly stale — pane to the reads below, which is exactly what
// isStaleResult exists to catch.
export async function waitForJobDetailToLoad(
    page: Page,
    sourceJobId: string | null,
    budget?: JobBudget,
): Promise<void> {
    if (sourceJobId) {
        await page
            .locator(`${DETAIL_TITLE_LINK_SELECTOR}[href*="-${sourceJobId}"]`)
            .first()
            .waitFor({
                state: 'visible',
                timeout: budget?.boundedTimeout(8000) ?? 8000,
            })
            .catch(() => {});
    }

    await page
        .waitForLoadState('networkidle', {
            timeout: budget?.boundedTimeout(5000) ?? 5000,
        })
        .catch(() => {});
}
