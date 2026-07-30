import type { Locator, Page } from 'playwright';
import {
    COMPANY_SELECTOR,
    DESCRIPTION_SELECTOR,
    LIST_COMPANY_SELECTOR,
} from '../selectors';
import { trim } from './trim';
import { isCompanyMismatch } from './isCompanyMismatch';
import { checkForLateOverlay } from './checkForLateOverlay';

interface JobDetailPane {
    company: string;
    descriptionText: string;
    companyMismatch: boolean;
    lateOverlayDetected: boolean;
}

// Reads the detail pane once it's loaded after the click. Unlike the list
// identity in `readJobListIdentity`, none of these fields survive a partial
// failure — scrapeJob's catch block always reports company/descriptionText
// as null regardless of how far this got — so this can simply throw without
// needing to hand anything back to the caller first.
export async function readJobDetailPane(
    jobItem: Locator,
    page: Page,
): Promise<JobDetailPane> {
    const company = await trim<string>(jobItem, COMPANY_SELECTOR, { page });
    if (!company) throw new Error('No company in detail pane for job');
    const descriptionText = await trim<string>(jobItem, DESCRIPTION_SELECTOR, {
        page,
    });
    if (!descriptionText)
        throw new Error('No description text found for list item');
    const companyMismatch = isCompanyMismatch({
        listCompany: await trim(jobItem, LIST_COMPANY_SELECTOR),
        detailCompany: company,
    });
    const lateOverlayDetected = await checkForLateOverlay(page);
    return { company, descriptionText, companyMismatch, lateOverlayDetected };
}
