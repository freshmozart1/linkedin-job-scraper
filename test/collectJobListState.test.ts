import { describe, it } from 'node:test';
import { collectJobListState } from '../src/scraper/collectJobListState';
import { createFakePage } from './helpers/fakePlaywright';

describe('collectJobListState()', () => {
    it('keeps first occurrences in raw order and retains unparseable cards individually', async ({
        assert,
    }) => {
        const page = createFakePage({
            url: () =>
                'https://www.linkedin.com/jobs/search?keywords=backend',
            evaluate: () => [
                {
                    entityUrn: 'urn:li:jobPosting:100',
                    href: '/jobs/view/backend-999/?trk=search',
                },
                { entityUrn: 'urn:li:jobPosting:200', href: null },
                { entityUrn: 'urn:li:jobPosting:300', href: null },
                { entityUrn: 'urn:li:jobPosting:200', href: null },
                {
                    entityUrn: null,
                    href: '/jobs/view/backend-400/?trk=search',
                },
                { entityUrn: null, href: null },
                { entityUrn: null, href: null },
            ],
        });

        const state = await collectJobListState(page);

        assert.equal(state.rawCount, 7);
        assert.equal(state.uniqueCount, 6);
        assert.deepEqual(state.uniqueJobs, [
            { sourceJobId: '100', rawIndex: 0 },
            { sourceJobId: '200', rawIndex: 1 },
            { sourceJobId: '300', rawIndex: 2 },
            { sourceJobId: '400', rawIndex: 4 },
            { sourceJobId: null, rawIndex: 5 },
            { sourceJobId: null, rawIndex: 6 },
        ]);
    });
});
