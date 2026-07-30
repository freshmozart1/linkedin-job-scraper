import { describe, it } from 'node:test';
import { normalizeJobUrl } from '../src';

const SEARCH_PAGE_URL = 'https://de.linkedin.com/jobs/search?keywords=frontend';

describe('normalizeJobUrl()', () => {
    it('strips per-session tracking params LinkedIn puts on the card job link', ({
        assert,
    }) => {
        assert.equal(
            normalizeJobUrl(
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111?refId=xY7%2Fabc&trackingId=Qk9%3D&position=3&pageNum=0&trk=public_jobs_jserp-result_search-card',
                SEARCH_PAGE_URL,
            ),
            'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
        );
    });

    it('resolves a relative job href against the search page URL', ({
        assert,
    }) => {
        assert.equal(
            normalizeJobUrl(
                '/jobs/view/frontend-developer-at-acme-111',
                SEARCH_PAGE_URL,
            ),
            'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
        );
    });

    it('returns null for a missing or hostname-less href', ({ assert }) => {
        assert.equal(normalizeJobUrl(null, SEARCH_PAGE_URL), null);
        assert.equal(normalizeJobUrl(undefined, SEARCH_PAGE_URL), null);
        assert.equal(
            normalizeJobUrl('javascript:void(0)', SEARCH_PAGE_URL),
            null,
        );
    });
});
