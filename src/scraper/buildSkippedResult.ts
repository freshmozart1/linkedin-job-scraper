import type { JobCardIdentity, SkippedJobResult } from '../types';

/**
 * Assembles the `'skipped'` result for a job card that `ScraperOptions.shouldScrapeJob`
 * filtered out before the click — split out of `scrapeJob` so the skip branch's
 * result-building (including the `duplicateOfIdx` self-reference guard below)
 * doesn't add to that function's own complexity.
 *
 * Not registered via `registerJobOccurrence` — a skipped job never becomes the
 * map's "first occurrence" for later duplicates to point at (see the skip-branch
 * test coverage in `scrapeJob.test.ts`). But if an *earlier* list index already
 * registered this sourceJobId (this posting was scraped in full elsewhere in
 * the run before this occurrence was filtered out), that's a real duplicate and
 * `duplicateOfIdx` must say so — not doing so would violate the field's own
 * contract ("index of the earlier job in this run with the same posting ID;
 * null when not a duplicate"). Guarded against self-reference the same way
 * `registerJobOccurrence` is, in case this exact index was already registered
 * on an earlier pass (a stale retry re-evaluating `shouldScrapeJob` for itself).
 */
export function buildSkippedResult(
    index: number,
    identity: JobCardIdentity,
    seenSourceJobIds: Map<string, number>,
): SkippedJobResult {
    const firstSeenIndex = seenSourceJobIds.get(identity.sourceJobId);
    return {
        index,
        status: 'skipped',
        ...identity,
        company: null,
        descriptionText: null,
        companyMismatch: false,
        sourceJobIdMismatch: false,
        lateOverlayDetected: false,
        scrapedAt: new Date().toISOString(),
        duplicateOfIdx:
            firstSeenIndex === undefined || firstSeenIndex === index
                ? null
                : firstSeenIndex,
        companyAddresses: null,
        tags: null,
    };
}
