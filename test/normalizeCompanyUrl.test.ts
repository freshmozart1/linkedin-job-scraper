import { describe, it } from 'node:test';
import { normalizeCompanyUrl } from '../src';

const SEARCH_PAGE_URL = 'https://de.linkedin.com/jobs/search?keywords=frontend';

describe('normalizeCompanyUrl()', () => {
    it('strips the trk tracking param LinkedIn puts on the card company link', ({
        assert,
    }) => {
        assert.equal(
            normalizeCompanyUrl(
                'https://de.linkedin.com/company/yatta-solutions-gmbh?trk=public_jobs_jserp-result_job-search-card-subtitle',
                SEARCH_PAGE_URL,
            ),
            'https://de.linkedin.com/company/yatta-solutions-gmbh',
        );
    });

    it('resolves a relative company href against the search page URL', ({
        assert,
    }) => {
        assert.equal(
            normalizeCompanyUrl(
                '/company/yatta-solutions-gmbh',
                SEARCH_PAGE_URL,
            ),
            'https://de.linkedin.com/company/yatta-solutions-gmbh',
        );
    });

    it('returns null for a missing or hostname-less href', ({ assert }) => {
        assert.equal(normalizeCompanyUrl(null, SEARCH_PAGE_URL), null);
        assert.equal(
            normalizeCompanyUrl('javascript:void(0)', SEARCH_PAGE_URL),
            null,
        );
    });
});
