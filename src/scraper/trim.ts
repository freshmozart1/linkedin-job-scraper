import type { Locator, Page } from 'playwright';
import type { JobBudget } from '../types';
import { JOB_CRITERIA_VALUE_SELECTOR } from '../selectors';
import { boundedTimeout } from './jobBudget';

// Reads a single field off `jobItem` (or, for the job-criteria list, off
// `page`'s detail pane once it's loaded). A plain function rather than a
// closure over `jobItem`/`page` so it can be shared across files by
// scrapeJob and its extracted read helpers (readJobListIdentity,
// readJobDetailPane); every read still gets its own explicit timeout and
// its own fallback-on-failure.
//
// `budget` clamps that per-read timeout to what is left of the job's own
// wall-clock budget, so a card whose every field times out cannot spend
// 1000ms apiece past a deadline that has already passed. The clamp can only
// ever shorten a read — its 1000ms cap still applies — and it deliberately
// never throws, since the catch below would swallow it and report a
// missing-element fallback instead of the real reason.
export async function trim<T = string | string[] | null>(
    jobItem: Locator,
    locator: string,
    {
        attr,
        page: p,
        budget,
    }: { attr?: string; page?: Page; budget?: JobBudget } = {},
): Promise<T> {
    const isJobCriteria = locator === JOB_CRITERIA_VALUE_SELECTOR;
    const timeout = boundedTimeout(budget, 1000);
    const el = (isJobCriteria && p ? p : (p ?? jobItem))
        .locator(locator)
        .first();
    try {
        if (isJobCriteria && p)
            return (await el
                .waitFor({
                    state: 'attached',
                    timeout,
                })
                .catch(() => {})
                .then(() =>
                    p.locator(JOB_CRITERIA_VALUE_SELECTOR).allInnerTexts(),
                )
                .then((texts) =>
                    texts.map((t) => t.trim()).filter(Boolean),
                )) as T;
        const val = attr
            ? await el.getAttribute(attr, { timeout })
            : await el.innerText({ timeout });
        return (val?.trim() || '') as unknown as T;
    } catch {
        return (isJobCriteria ? null : '') as unknown as T;
    }
}
