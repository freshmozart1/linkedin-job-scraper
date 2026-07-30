import { describe, it } from 'node:test';
import { jobIdFromUrl } from '../src';

describe('jobIdFromUrl()', () => {
    it('recovers the trailing numeric ID from a job URL', ({ assert }) => {
        assert.equal(
            jobIdFromUrl(
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-4012345678',
            ),
            '4012345678',
        );
    });

    it('recovers the ID when the URL has a trailing slash', ({ assert }) => {
        assert.equal(
            jobIdFromUrl(
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-4012345678/',
            ),
            '4012345678',
        );
    });

    it('returns null when the URL has no trailing numeric ID', ({ assert }) => {
        assert.equal(
            jobIdFromUrl(
                'https://de.linkedin.com/jobs/view/frontend-developer',
            ),
            null,
        );
    });

    it('returns null for missing input', ({ assert }) => {
        assert.equal(jobIdFromUrl(null), null);
        assert.equal(jobIdFromUrl(undefined), null);
    });
});
