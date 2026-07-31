// Playwright driver for LinkedIn's public/guest job search results: loads
// all jobs via infinite scroll, clicks every job card in the list, and
// scrapes title/company/description for each one.
//
// Guest/unauthenticated view only — no login, no credentials. LinkedIn's
// markup and anti-bot gating can change or vary by session (this page can
// show a dismissible "sign in to view more jobs" nag at any point, even on
// initial load), so this is still scraping an unofficial, moving surface.
//
// This is a folder of one-function-per-file modules rather than a single
// flat file. Internal helpers are intentionally not re-exported here — the
// exported subset below is what the tests drive directly (see CLAUDE.md).

export { runScrape } from './runScrape';
export { ScrapeAbortedError } from './ScrapeAbortedError';
export { scrapeJob } from './scrapeJob';
export { scrapeAllJobsOnce } from './scrapeAllJobsOnce';
export { clearBlockingOverlays } from './clearBlockingOverlays';
export { scrollLoadPhase } from './scrollLoadPhase';
export { clickLoadPhase } from './clickLoadPhase';
export { registerJobOccurrence } from './registerJobOccurrence';
export { isCompanyMismatch } from './isCompanyMismatch';
export { isSourceJobIdMismatch } from './isSourceJobIdMismatch';
export { isStaleResult } from './isStaleResult';

export type { ScrapeContext } from './scrapeContext';
export type { ScrapeJobOptions } from './scrapeJob';
export type { ScrollLoadPhaseOptions } from './scrollLoadPhase';
export type { ClickLoadPhaseOptions } from './clickLoadPhase';
