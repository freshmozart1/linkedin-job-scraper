import { describe, it } from 'node:test';
import { registerJobOccurrence } from '../src';

describe('registerJobOccurrence()', () => {
    it('registers a first occurrence and reports no duplicate', ({
        assert,
    }) => {
        const seen = new Map<string, number>();
        assert.equal(registerJobOccurrence(seen, '12345', 0), null);
        assert.equal(seen.get('12345'), 0);
    });
    it('reports a later occurrence as duplicate of the first index', ({
        assert,
    }) => {
        const seen = new Map<string, number>();
        registerJobOccurrence(seen, '12345', 2);
        assert.equal(registerJobOccurrence(seen, '12345', 5), 2);
    });
    it('keeps the map pointing at the first occurrence', ({ assert }) => {
        const seen = new Map<string, number>();
        registerJobOccurrence(seen, '12345', 2);
        registerJobOccurrence(seen, '12345', 5);
        assert.equal(seen.get('12345'), 2);
        // a third occurrence still resolves to the first, not the second
        assert.equal(registerJobOccurrence(seen, '12345', 9), 2);
    });
    it('does not flag a job as a duplicate of itself (stale retry)', ({
        assert,
    }) => {
        const seen = new Map<string, number>();
        registerJobOccurrence(seen, '12345', 3);
        assert.equal(registerJobOccurrence(seen, '12345', 3), null);
    });
    it('ignores jobs with no posting ID', ({ assert }) => {
        const seen = new Map<string, number>();
        assert.equal(registerJobOccurrence(seen, null, 0), null);
        assert.equal(registerJobOccurrence(seen, null, 1), null);
        assert.equal(seen.size, 0);
    });
});
