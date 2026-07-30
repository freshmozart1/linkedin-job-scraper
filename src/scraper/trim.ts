import type { Locator, Page } from 'playwright';
import { JOB_CRITERIA_VALUE_SELECTOR } from '../selectors';

// Reads a single field off `jobItem` (or, for the job-criteria list, off
// `page`'s detail pane once it's loaded). A plain function rather than a
// closure over `jobItem`/`page` so it can be shared across files by
// scrapeJob and its extracted read helpers (readJobListIdentity,
// readJobDetailPane); every read still gets its own explicit timeout and
// its own fallback-on-failure.
export async function trim<T = string | string[] | null>(
    jobItem: Locator,
    locator: string,
    { attr, page: p }: { attr?: string; page?: Page } = {},
): Promise<T> {
    const isJobCriteria = locator === JOB_CRITERIA_VALUE_SELECTOR;
    const el = (isJobCriteria && p ? p : (p ?? jobItem))
        .locator(locator)
        .first();
    try {
        if (isJobCriteria && p)
            return (await el
                .waitFor({ state: 'attached', timeout: 1000 })
                .catch(() => {})
                .then(() =>
                    p.locator(JOB_CRITERIA_VALUE_SELECTOR).allInnerTexts(),
                )
                .then((texts) =>
                    texts.map((t) => t.trim()).filter(Boolean),
                )) as T;
        const val = attr
            ? await el.getAttribute(attr, { timeout: 1000 })
            : await el.innerText({ timeout: 1000 });
        return (val?.trim() || '') as unknown as T;
    } catch {
        return (isJobCriteria ? null : '') as unknown as T;
    }
}
