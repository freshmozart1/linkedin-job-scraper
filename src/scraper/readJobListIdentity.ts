import type { Locator, Page } from 'playwright';
import { jobIdFromUrl } from '../url';
import {
    JOB_LINK_SELECTOR,
    LIST_COMPANY_LINK_SELECTOR,
    LIST_LOCATION_SELECTOR,
    LIST_POSTED_AT_SELECTOR,
} from '../selectors';
import { trim } from './trim';

export interface JobListIdentity {
    title: string | null;
    sourceUrl: string | null;
    sourceHostname: string | null;
    sourceJobId: string | null;
    companyUrl: string | null;
    location: string | null;
    postedAt: string | null;
}

// Reads everything scrapeJob needs off the list card itself (title, its own
// URL/hostname/ID, the company's URL, location, posted date) in the same
// sequential order and with the same per-field error as before. Takes the
// caller's own `identity` object and assigns each field onto it as it's
// read, rather than building a fresh object and returning it only on
// success — so if a later field throws, everything read so far is still
// visible on the object the caller already holds. That's what lets
// scrapeJob's catch block return a partial identity instead of losing it
// along with the rest of a failed job.
export async function readJobListIdentity(
    jobItem: Locator,
    page: Page,
    identity: JobListIdentity,
): Promise<void> {
    identity.title = await trim<string>(jobItem, 'h3');
    if (!identity.title)
        throw new Error(
            'No job title found for this list item - LinkedIn markup has likely changed',
        );
    const jobHref = await trim(jobItem, JOB_LINK_SELECTOR, { attr: 'href' });
    if (!jobHref) throw new Error('No job href found for this list item');
    const jobUrl = new URL(jobHref, page.url());
    if (!jobUrl.hostname)
        throw new Error('No job URL hostname found for this list item');
    identity.sourceHostname = jobUrl.hostname;
    jobUrl.search = ''; // normalize to a canonical URL without query params
    jobUrl.hash = ''; // normalize to a canonical URL without fragment
    identity.sourceUrl = jobUrl.toString();
    const entityUrn = await trim<string>(jobItem, '.base-card', {
        attr: 'data-entity-urn',
    });
    identity.sourceJobId =
        entityUrn.match(/jobPosting:(\d+)$/)?.[1] ??
        jobIdFromUrl(identity.sourceUrl) ??
        '';
    if (!identity.sourceJobId)
        throw new Error(
            'No source job ID found for job item - LinkedIn markup has likely changed',
        );
    const companyHref = await trim(jobItem, LIST_COMPANY_LINK_SELECTOR, {
        attr: 'href',
    });
    if (!companyHref) throw new Error('No company href found for list item');
    const companyUrlObj = new URL(companyHref, page.url());
    if (!companyUrlObj.hostname)
        throw new Error('No company URL hostname found for list item');
    companyUrlObj.search = '';
    companyUrlObj.hash = '';
    identity.companyUrl = companyUrlObj.toString();
    identity.location = await trim(jobItem, LIST_LOCATION_SELECTOR);
    if (!identity.location) throw new Error('No location found for list item');
    identity.postedAt = await trim(jobItem, LIST_POSTED_AT_SELECTOR, {
        attr: 'datetime',
    });
    if (!identity.postedAt)
        throw new Error('No posted date found for list item');
}
