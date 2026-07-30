import type { Page } from 'playwright';

// LinkedIn's guest infinite scroll can, on a long enough session, stop
// returning genuinely new pages and instead re-serve an earlier page (a
// pagination cursor / bot-detection reset, by the look of it — a clean,
// non-interleaved repeat of the first N jobs, not random duplication).
// Counting raw `<li>` nodes can't tell a repeated page apart from a new one,
// so track the set of distinct job IDs instead: once that stops growing, the
// unique results are exhausted even if the DOM keeps appending more nodes.
export async function collectJobIds(page: Page): Promise<Set<string>> {
    const ids = await page.evaluate(() => {
        // Runs in the browser context; this package compiles without the DOM
        // lib, so only the specific members used here are typed structurally.
        interface MinimalElement {
            querySelector(selector: string): MinimalElement | null;
            getAttribute(name: string): string | null;
        }
        const g = globalThis as unknown as {
            document: {
                querySelectorAll(selector: string): ArrayLike<MinimalElement>;
            };
        };
        // Also hardcoded literally here (page.evaluate serializes the callback
        // via toString(), so it can't close over selectors.ts's export) — keep
        // in sync with JOB_LIST_SELECTOR in ../selectors if this ever changes.
        const lis = Array.from(
            g.document.querySelectorAll('ul.jobs-search__results-list > li'),
        ).filter((li) => li.querySelector('h3'));
        return lis.map((li, i) => {
            const urn =
                li
                    .querySelector('.base-card')
                    ?.getAttribute('data-entity-urn') ?? '';
            const match = urn.match(/jobPosting:(\d+)$/);
            return match?.[1] ?? `__unparseable_${i}`;
        });
    });
    return new Set(ids);
}
