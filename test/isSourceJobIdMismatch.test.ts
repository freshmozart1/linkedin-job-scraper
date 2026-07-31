import { describe, it } from 'node:test';
import { isSourceJobIdMismatch } from '../src';

const BASE_URL = 'https://www.linkedin.com/jobs/search?keywords=frontend';

describe('isSourceJobIdMismatch()', () => {
    it('is false when the source job ID could not be read', ({ assert }) => {
        assert.equal(
            isSourceJobIdMismatch({
                sourceJobId: null,
                detailTitleHref:
                    'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
                baseUrl: BASE_URL,
            }),
            false,
        );
    });

    it('is false when the detail title href could not be read', ({
        assert,
    }) => {
        assert.equal(
            isSourceJobIdMismatch({
                sourceJobId: '111',
                detailTitleHref: null,
                baseUrl: BASE_URL,
            }),
            false,
        );
    });

    it("is false when the detail title href's job ID can't be parsed", ({
        assert,
    }) => {
        assert.equal(
            isSourceJobIdMismatch({
                sourceJobId: '111',
                detailTitleHref: 'https://de.linkedin.com/jobs/view/frontend-developer-at-acme',
                baseUrl: BASE_URL,
            }),
            false,
        );
    });

    it('is false when both sides carry the same job ID, tracking query string included', ({
        assert,
    }) => {
        assert.equal(
            isSourceJobIdMismatch({
                sourceJobId: '4442367237',
                detailTitleHref:
                    'https://de.linkedin.com/jobs/view/frontend-entwickler-m-w-d-at-cpu-softwarehouse-ag-4442367237?trk=public_jobs_topcard-title',
                baseUrl: BASE_URL,
            }),
            false,
        );
    });

    it('is true when the detail pane is left over from a different posting, even at the same company', ({
        assert,
    }) => {
        assert.equal(
            isSourceJobIdMismatch({
                sourceJobId: '4419852332',
                detailTitleHref:
                    'https://de.linkedin.com/jobs/view/frontend-entwickler-m-w-d-at-cpu-softwarehouse-ag-4442367237?trk=public_jobs_topcard-title',
                baseUrl: BASE_URL,
            }),
            true,
        );
    });
});
