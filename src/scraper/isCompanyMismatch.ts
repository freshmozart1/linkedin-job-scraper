import type { CompanyMismatchCheck } from '../types';

// LinkedIn's guest detail pane sometimes doesn't re-render when jobs are
// clicked in quick succession: the title link is supposed to update first
// (scrapeJob's waitForJobDetailToLoad waits for that), but the wait is
// best-effort and silently gives up on timeout, so the title link itself can
// still be stale too — see isSourceJobIdMismatch, which catches that case.
// This check instead compares the company name shown in the list item
// (which doesn't change on click) against the company name read from the
// detail pane, which catches a stale pane regardless of which job it leaked
// from — except when the leftover pane belongs to an earlier posting at the
// *same* company, which isSourceJobIdMismatch closes.
export function isCompanyMismatch({
    listCompany,
    detailCompany,
}: CompanyMismatchCheck): boolean {
    if (!listCompany || !detailCompany) return false;
    return listCompany.trim() !== detailCompany.trim();
}
