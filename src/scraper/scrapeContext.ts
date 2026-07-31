import type { Page } from 'playwright';
import type { ScrapeProgressEvent } from '../types';
import type { CompanyLookup } from '../companyLookup';

export interface ScrapeContext {
    page: Page;
    totalJobs: number;
    seenSourceJobIds: Map<string, number>;
    onProgress?: (event: ScrapeProgressEvent) => void;
    runTimestamp: number;
    delayBetweenJobsMs?: number;
    clickRetryAttempts?: number;
    companyLookup: CompanyLookup;
    signal?: AbortSignal;
}
