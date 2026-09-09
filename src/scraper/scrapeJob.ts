import type { Page } from 'playwright';
import type { JobResult } from '../types';
import { jobItemsLocator } from './jobItemsLocator';
import {
    scrapeJobFromLocator,
    type ScrapeJobOptions,
} from './scrapeJobFromLocator';

export type { ScrapeJobOptions } from './scrapeJobFromLocator';

// Public low-level entry point: its index continues to mean the raw filtered
// list position. runScrape's unique-card traversal uses the internal
// locator-based implementation so it can keep logical result indices separate
// from LinkedIn's duplicate-filled DOM positions.
export function scrapeJob(
    page: Page,
    index: number,
    options: ScrapeJobOptions,
): Promise<JobResult> {
    return scrapeJobFromLocator(
        page,
        index,
        jobItemsLocator(page).nth(index),
        null,
        options,
    );
}
