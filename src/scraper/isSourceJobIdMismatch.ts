import type { SourceJobIdMismatchCheck } from '../types';
import { normalizeJobUrl, jobIdFromUrl } from '../url';

// Closes the blind spot `isCompanyMismatch` has for a detail pane left over
// from an earlier posting at the *same* company (company text still matches
// there even though the pane never updated). The detail pane's own title
// link carries the ID of whichever job is actually rendered, independent of
// company, so comparing that against the clicked job's own ID catches it.
export function isSourceJobIdMismatch({
    sourceJobId,
    detailTitleHref,
    baseUrl,
}: SourceJobIdMismatchCheck): boolean {
    if (!sourceJobId || !detailTitleHref) return false;
    const detailJobId = jobIdFromUrl(normalizeJobUrl(detailTitleHref, baseUrl));
    if (!detailJobId) return false;
    return detailJobId !== sourceJobId;
}
