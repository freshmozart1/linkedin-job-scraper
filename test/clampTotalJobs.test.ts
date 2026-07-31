import { describe, it } from 'node:test';
import { clampTotalJobs } from '../src';

describe('clampTotalJobs()', () => {
    it('returns the discovered total unchanged when maxJobs is undefined', ({
        assert,
    }) => {
        assert.equal(clampTotalJobs(42, undefined), 42);
    });

    it('caps the total when maxJobs is below the discovered count', ({
        assert,
    }) => {
        assert.equal(clampTotalJobs(42, 10), 10);
    });

    it('never expands past the discovered count when maxJobs is above it', ({
        assert,
    }) => {
        assert.equal(clampTotalJobs(42, 100), 42);
    });

    it('returns the discovered total when maxJobs equals it exactly', ({
        assert,
    }) => {
        assert.equal(clampTotalJobs(42, 42), 42);
    });

    it('floors at zero rather than going negative when maxJobs is 0', ({
        assert,
    }) => {
        assert.equal(clampTotalJobs(42, 0), 0);
    });

    it('floors at zero rather than going negative when maxJobs is negative', ({
        assert,
    }) => {
        assert.equal(clampTotalJobs(42, -5), 0);
    });
});
