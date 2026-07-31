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

    it('is true for a successful result with a source job ID mismatch', ({
        assert,
    }) => {
        assert.equal(
            isStaleResult(makeResult({ index: 0, sourceJobIdMismatch: true })),
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
            isStaleResult({
                index: 0,
                status: 'failed',
                error: 'boom',
                title: null,
                company: null,
                descriptionText: null,
                companyMismatch: true,
                sourceJobIdMismatch: true,
                lateOverlayDetected: true,
                sourceJobId: null,
                sourceUrl: null,
                sourceHostname: null,
                scrapedAt: '2024-01-01T00:00:00.000Z',
                duplicateOfIdx: null,
                companyUrl: null,
                companyAddresses: null,
                location: null,
                postedAt: null,
                tags: null,
            }),
            false,
        );
    });
});
