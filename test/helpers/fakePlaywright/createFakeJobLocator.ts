import { createFakeLocator } from './createFakeLocator';
import type { Locator } from 'playwright';
import type { AttributeRead } from './interfaces';
import {
    LIST_COMPANY_SELECTOR,
    JOB_LINK_SELECTOR,
    LIST_COMPANY_LINK_SELECTOR,
    LIST_LOCATION_SELECTOR,
    LIST_POSTED_AT_SELECTOR,
} from '../../../src';

/** Builds a fake job-list `<li>` locator matching the exact chain scrapeJob() reads. */
export function createFakeJobLocator(opts: {
    title: string | null;
    listCompany: string | null;
    sourceJobId: string | null;
    sourceUrl?: string | null;
    onClick?: () => void;
    hasTitle?: boolean;
    /**
     * Simulates `.base-card` being absent from the markup. Playwright's
     * getAttribute auto-waits for the element and *rejects* on timeout — it
     * does not resolve to null — so this throws rather than returning null.
     */
    entityUrnUnreadable?: boolean;
    /** Collects every getAttribute call, so tests can assert reads are bounded. */
    attributeReads?: AttributeRead[];
    /** The href on the card's company link, which the address lookup is keyed on. */
    companyUrl?: string | null;
    /** The list card's location span text. Undefined/null simulates an unreadable/absent element. */
    location?: string | null;
    /** The list card's `datetime` attribute. */
    postedAt?: string | null;
    /** Simulates the postedAt getAttribute call rejecting (e.g. a genuine timeout), mirroring entityUrnUnreadable. */
    postedAtUnreadable?: boolean;
}): Locator {
    const hasTitle = opts.hasTitle ?? true;
    return createFakeLocator({
        click: opts.onClick,
        locator: (selector) => {
            if (selector === 'h3') {
                return createFakeLocator({
                    count: () => (hasTitle ? 1 : 0),
                    innerText: () => {
                        if (opts.title === null)
                            throw new Error('no title element');
                        return opts.title;
                    },
                });
            }
            if (selector === LIST_COMPANY_SELECTOR) {
                return createFakeLocator({
                    innerText: () => {
                        if (opts.listCompany === null)
                            throw new Error('no company element');
                        return opts.listCompany;
                    },
                });
            }
            if (selector === '.base-card') {
                return createFakeLocator({
                    getAttribute: (name, options) => {
                        opts.attributeReads?.push({ name, options });
                        if (opts.entityUrnUnreadable) {
                            throw new Error(
                                'locator.getAttribute: Timeout 30000ms exceeded',
                            );
                        }
                        return opts.sourceJobId
                            ? `urn:li:fsd_jobPosting:${opts.sourceJobId}`
                            : null;
                    },
                });
            }
            if (selector === JOB_LINK_SELECTOR) {
                return createFakeLocator({
                    getAttribute: (name, options) => {
                        opts.attributeReads?.push({ name, options });
                        return opts.sourceUrl ?? null;
                    },
                });
            }
            if (selector === LIST_COMPANY_LINK_SELECTOR) {
                return createFakeLocator({
                    getAttribute: (name, options) => {
                        opts.attributeReads?.push({ name, options });
                        return opts.companyUrl ?? null;
                    },
                });
            }
            if (selector === LIST_LOCATION_SELECTOR) {
                return createFakeLocator({
                    innerText: () => {
                        if (opts.location == null)
                            throw new Error('no location element');
                        return opts.location;
                    },
                });
            }
            if (selector === LIST_POSTED_AT_SELECTOR) {
                return createFakeLocator({
                    getAttribute: (name, options) => {
                        opts.attributeReads?.push({ name, options });
                        if (opts.postedAtUnreadable) {
                            throw new Error(
                                'locator.getAttribute: Timeout 30000ms exceeded',
                            );
                        }
                        return opts.postedAt ?? null;
                    },
                });
            }
            return createFakeLocator();
        },
    });
}
