import { describe, it } from 'node:test';
import { buildSearchUrl } from '../src';

describe('buildSearchUrl()', () => {
    it('embeds the keywords in the keywords query param', (t) => {
        const url = new URL(buildSearchUrl({ keyword: 'Frontend Developer' }));
        t.assert.equal(url.searchParams.get('keywords'), 'Frontend Developer');
    });

    it('sends no location/geoId when none is supplied', ({ assert }) => {
        const url = new URL(buildSearchUrl({ keyword: 'Backend Developer' }));
        assert.equal(url.searchParams.has('location'), false);
        assert.equal(url.searchParams.has('geoId'), false);
    });

    it('sends location/geoId only when the caller explicitly supplies them', ({
        assert,
    }) => {
        const url = new URL(
            buildSearchUrl({
                keyword: 'Backend Developer',
                location: 'Berlin, Germany',
                geoId: '123',
            }),
        );
        assert.equal(url.searchParams.get('location'), 'Berlin, Germany');
        assert.equal(url.searchParams.get('geoId'), '123');
    });

    it('encodes special characters in the keyword', ({ assert }) => {
        //TODO #8
        const url = new URL(buildSearchUrl({ keyword: 'C++ / C# Developer' }));
        assert.equal(url.searchParams.get('keywords'), 'C++ / C# Developer');
    });

    it('targets the LinkedIn guest job search path', ({ assert }) => {
        const url = new URL(buildSearchUrl({ keyword: 'Frontend Developer' }));
        assert.equal(
            url.origin + url.pathname,
            'https://www.linkedin.com/jobs/search',
        );
    });

    it('translates datePosted/experienceLevels/jobTypes/workplaceTypes/sortBy to LinkedIn query codes', ({
        assert,
    }) => {
        const url = new URL(
            buildSearchUrl({
                keyword: 'Engineer',
                datePosted: 'week',
                experienceLevels: ['entry', 'mid-senior'],
                jobTypes: ['full-time', 'contract'],
                workplaceTypes: ['remote'],
                distanceMiles: 25,
                sortBy: 'date',
            }),
        );
        assert.equal(url.searchParams.get('f_TPR'), 'r604800');
        assert.equal(url.searchParams.get('f_E'), '2,4');
        assert.equal(url.searchParams.get('f_JT'), 'F,C');
        assert.equal(url.searchParams.get('f_WT'), '2');
        assert.equal(url.searchParams.get('distance'), '25');
        assert.equal(url.searchParams.get('sortBy'), 'DD');
    });

    it('applies extraParams verbatim as an escape hatch', ({ assert }) => {
        const url = new URL(
            buildSearchUrl({
                keyword: 'Engineer',
                extraParams: { trk: 'custom-trk', pageNum: '2' },
            }),
        );
        assert.equal(url.searchParams.get('trk'), 'custom-trk');
        assert.equal(url.searchParams.get('pageNum'), '2');
    });
});
