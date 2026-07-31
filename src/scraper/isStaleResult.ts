import type { JobResult } from '../types';

// A "stale" result is a successful scrape whose data might be untrustworthy:
// the detail-pane company disagreed with the list, the detail pane's own job
// ID disagreed with the clicked job's (catching a same-company leftover pane
// that `companyMismatch` alone misses), or a sign-in overlay was still
// visible right when the data was read. `status: 'failed'` never counts —
// scrapeJob's catch block always forces all three flags false on failure, so
// this predicate excludes failures without a separate check.
export function isStaleResult(result: JobResult): boolean {
    return (
        result.status === 'success' &&
        (result.companyMismatch ||
            result.sourceJobIdMismatch ||
            result.lateOverlayDetected)
    );
}
