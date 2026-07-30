import type { CompanyMismatchCheck } from '../types';

// LinkedIn's guest detail pane sometimes doesn't re-render when jobs are
// clicked in quick succession: the title link updates (scrapeJob already
// waits for that) but the rest of the pane is left over from the previously
// clicked job. Comparing the company name shown in the list item (which
// doesn't change on click) against the company name read from the detail
// pane catches that case directly, regardless of which job it leaked from.
export function isCompanyMismatch({
    listCompany,
    detailCompany,
}: CompanyMismatchCheck): boolean {
    if (!listCompany || !detailCompany) return false;
    return listCompany.trim() !== detailCompany.trim();
}
