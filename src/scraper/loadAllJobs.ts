import type { Page } from 'playwright';
import type { ScraperOptions, ScrapeProgressEvent } from '../types';
import { SEE_MORE_BUTTON_SELECTOR } from '../selectors';
import { scrollLoadPhase } from './scrollLoadPhase';
import { clickLoadPhase } from './clickLoadPhase';
import { collectJobIds } from './collectJobIds';

export async function loadAllJobs(
    page: Page,
    scraperOptions: ScraperOptions | undefined,
    onProgress?: (event: ScrapeProgressEvent) => void,
    signal?: AbortSignal,
): Promise<number> {
    const seeMoreButton = page.locator(SEE_MORE_BUTTON_SELECTOR);
    const afterScrollCount = await scrollLoadPhase(page, seeMoreButton, {
        maxScrollAttempts: scraperOptions?.maxScrollAttempts,
        stableScrollsToStop: scraperOptions?.stableScrollsToStop,
        onProgress,
        signal,
    });
    await clickLoadPhase(page, seeMoreButton, afterScrollCount, {
        maxSeeMoreClicks: scraperOptions?.maxSeeMoreClicks,
        stableClicksToStop: scraperOptions?.stableClicksToStop,
        clickRetryAttempts: scraperOptions?.clickRetryAttempts,
        onProgress,
        signal,
    });
    return (await collectJobIds(page)).size;
}
