import type { CompanyAddress, CompanyLookup } from '../../src';

/**
 * A CompanyLookup that never touches a browser. `addresses` decides what every
 * lookup resolves to; `requested` records the URLs it was asked for, so tests
 * can assert on caching and on which card link the scraper actually read.
 */
export function stubCompanyLookup(
    addresses: CompanyAddress[] | null = null,
): CompanyLookup & { requested: (string | null)[] } {
    const requested: (string | null)[] = [];
    return {
        requested,
        async addressesFor(companyUrl) {
            requested.push(companyUrl);
            return companyUrl ? addresses : null;
        },
        async close() {},
    };
}
