import type { Page } from 'playwright';
import { jobIdFromUrl, normalizeJobUrl } from '../url';

export interface LoadedJob {
    /** Parsed posting identity; null keeps an unparseable card visible as its own failed result. */
    sourceJobId: string | null;
    /** Index within the h3-filtered raw list at the time this snapshot was read. */
    rawIndex: number;
}

export interface JobListState {
    /** Number of rendered h3-bearing job cards, including duplicate occurrences. */
    rawCount: number;
    /** First occurrence of every parsed posting ID, plus every unparseable card. */
    uniqueJobs: LoadedJob[];
    uniqueCount: number;
}

// Reads raw list-card identity carriers once, then resolves and deduplicates
// them in Node with the same URL helpers scrapeJob uses. Keeping parsing out
// of page.evaluate avoids a second subtly different job-ID contract in the
// browser context. First occurrence wins, preserving list order. A card with
// neither a parseable URN nor href is deliberately retained with a null ID so
// the ordinary scrape path reports its markup failure instead of silently
// removing a list position.
export async function collectJobListState(page: Page): Promise<JobListState> {
    const cards = await page.evaluate(() => {
        interface MinimalElement {
            querySelector(selector: string): MinimalElement | null;
            getAttribute(name: string): string | null;
        }
        const g = globalThis as unknown as {
            document: {
                querySelectorAll(selector: string): ArrayLike<MinimalElement>;
            };
        };
        // JOB_LIST_SELECTOR and JOB_LINK_SELECTOR are hardcoded literally:
        // page.evaluate serializes this callback and cannot close over module
        // imports. Keep both in sync with ../selectors.
        return Array.from(
            g.document.querySelectorAll('ul.jobs-search__results-list > li'),
        )
            .filter((li) => li.querySelector('h3'))
            .map((li) => ({
                entityUrn:
                    li
                        .querySelector('.base-card')
                        ?.getAttribute('data-entity-urn') ?? null,
                href:
                    li
                        .querySelector('.base-card__full-link')
                        ?.getAttribute('href') ?? null,
            }));
    });

    const uniqueJobs: LoadedJob[] = [];
    const seenSourceJobIds = new Set<string>();
    const baseUrl = page.url();

    for (const [rawIndex, card] of cards.entries()) {
        const sourceJobId =
            card.entityUrn?.match(/jobPosting:(\d+)$/)?.[1] ??
            jobIdFromUrl(normalizeJobUrl(card.href, baseUrl));
        if (sourceJobId !== null) {
            if (seenSourceJobIds.has(sourceJobId)) continue;
            seenSourceJobIds.add(sourceJobId);
        }
        uniqueJobs.push({ sourceJobId, rawIndex });
    }

    return {
        rawCount: cards.length,
        uniqueJobs,
        uniqueCount: uniqueJobs.length,
    };
}
