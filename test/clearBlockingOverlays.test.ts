import { createFakeLocator, createFakePage } from './helpers/fakePlaywright';
import { describe, it } from 'node:test';
import { OVERLAY_SELECTOR, clearBlockingOverlays } from '../src';

describe('clearBlockingOverlays()', () => {
    it('returns false when no overlay is ever visible', async ({ assert }) => {
        const page = createFakePage({
            locatorsBySelector: {
                [OVERLAY_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
            },
        });

        const dismissed = await clearBlockingOverlays(page, {
            timeoutMs: 50,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
        });
        assert.equal(dismissed, false);
    });

    it('clicks the dismiss button and reports it dismissed an overlay', async ({
        assert,
    }) => {
        let visible = true;
        const overlay = createFakeLocator({
            isVisible: () => visible,
            waitFor: () => {
                visible = false;
            },
        });
        const page = createFakePage({
            locatorsBySelector: { [OVERLAY_SELECTOR]: overlay },
        });

        const dismissed = await clearBlockingOverlays(page, {
            timeoutMs: 500,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
        });
        assert.equal(dismissed, true);
    });

    it('keeps polling and gives up when the dismiss click never succeeds', async ({
        assert,
    }) => {
        const overlay = createFakeLocator({
            isVisible: () => true,
            click: () => {
                throw new Error('click intercepted by another overlay');
            },
        });
        const page = createFakePage({
            locatorsBySelector: { [OVERLAY_SELECTOR]: overlay },
        });

        const dismissed = await clearBlockingOverlays(page, {
            timeoutMs: 30,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
        });
        assert.equal(dismissed, false);
    });
});
