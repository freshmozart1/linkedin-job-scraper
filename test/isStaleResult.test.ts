import { describe, it } from 'node:test';
import { makeResult } from './helpers/makeResult';
import { isStaleResult } from '../src';

describe('isStaleResult()', () => {
    it('is false for a successful, clean result', ({ assert }) => {
        assert.equal(isStaleResult(makeResult({ index: 0 })), false);
    });

    it('is true for a successful result with a company mismatch', ({
        assert,
    }) => {
        assert.equal(
            isStaleResult(makeResult({ index: 0, companyMismatch: true })),
            true,
        );
    });

    it('is true for a successful result with a late overlay detected', ({
        assert,
    }) => {
        assert.equal(
            isStaleResult(makeResult({ index: 0, lateOverlayDetected: true })),
            true,
        );
    });
    it('is false for a failed result even if the stale flags are set', ({
        assert,
    }) => {
        assert.equal(
            isStaleResult(
                makeResult({
                    index: 0,
                    status: 'failed',
                    companyMismatch: true,
                    lateOverlayDetected: true,
                }),
            ),
            false,
        );
    });
});
