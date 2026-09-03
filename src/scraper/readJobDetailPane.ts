import type { Locator, Page } from 'playwright';
import type { JobBudget } from '../types';
import {
    COMPANY_SELECTOR,
    DESCRIPTION_SELECTOR,
    DETAIL_TITLE_LINK_SELECTOR,
    LIST_COMPANY_SELECTOR,
} from '../selectors';
import { trim } from './trim';
import { isCompanyMismatch } from './isCompanyMismatch';
import { isSourceJobIdMismatch } from './isSourceJobIdMismatch';
import { checkForLateOverlay } from './checkForLateOverlay';
import type { OverlayClearSettings } from './clearBlockingOverlays';

interface JobDetailPane {
    company: string;
    descriptionText: string;
    companyMismatch: boolean;
    sourceJobIdMismatch: boolean;
    lateOverlayDetected: boolean;
}

// Reads the detail pane once it's loaded after the click. Unlike the list
// identity in `readJobListIdentity`, none of these fields survive a partial
// failure — scrapeJob's catch block always reports company/descriptionText
// as null regardless of how far this got — so this can simply throw without
// needing to hand anything back to the caller first.
//
// `budget` is forwarded rather than consulted here: every wait this performs
// belongs to `trim` or to checkForLateOverlay, and each of those clamps its
// own timeout against it.
export async function readJobDetailPane(
    jobItem: Locator,
    page: Page,
    sourceJobId: string | null,
    overlayClear?: OverlayClearSettings,
    budget?: JobBudget,
): Promise<JobDetailPane> {
    const company = await trim<string>(jobItem, COMPANY_SELECTOR, {
        page,
        budget,
    });
    if (!company) throw new Error('No company in detail pane for job');
    const descriptionText = await trim<string>(jobItem, DESCRIPTION_SELECTOR, {
        page,
        budget,
    });
    if (!descriptionText)
        throw new Error('No description text found for list item');
    const companyMismatch = isCompanyMismatch({
        listCompany: await trim(jobItem, LIST_COMPANY_SELECTOR, { budget }),
        detailCompany: company,
    });
    const detailTitleHref = await trim<string>(
        jobItem,
        DETAIL_TITLE_LINK_SELECTOR,
        { page, attr: 'href', budget },
    );
    const sourceJobIdMismatch = isSourceJobIdMismatch({
        sourceJobId,
        detailTitleHref,
        baseUrl: page.url(),
    });
    const lateOverlayDetected = await checkForLateOverlay(
        page,
        overlayClear,
        budget,
    );
    return {
        company,
        descriptionText,
        companyMismatch,
        sourceJobIdMismatch,
        lateOverlayDetected,
    };
}
