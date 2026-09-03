import { createFakeLocator, createFakePage } from './helpers/fakePlaywright';
import { describe, it } from 'node:test';
import {
    OVERLAY_BUTTON_SELECTOR,
    OVERLAY_SELECTOR,
    clearBlockingOverlays,
} from '../src';
import type { OverlayDiagnostics, ScrapeProgressEvent } from '../src';

/** What an interstitial with nothing safe to click looks like to the diagnostics read. */
const SIGN_IN_OVERLAY: OverlayDiagnostics = {
    text: 'Sign in to view more jobs',
    classes: [
        'modal__overlay',
        'pointer-events-none',
        'modal__overlay--visible',
    ],
    buttonNames: ['Sign in', 'Join now'],
};

/**
 * Answers both `page.evaluate` shapes clearBlockingOverlays drives, told
 * apart by the explicit argument each helper passes: `readOverlayDiagnostics`
 * is the only one that names a button selector, `neutralizeOverlay` the only
 * one that names a class to strip. Dispatching on the real arg (rather than
 * one generic stub answering both) is what lets a test assert that
 * neutralization genuinely ran, and with which class.
 */
function overlayEvaluate(config: {
    diagnostics?: OverlayDiagnostics | null;
    neutralize?: (visibleClass: string) => number;
}): (arg?: unknown) => unknown {
    return (arg?: unknown) => {
        const passed = (arg ?? {}) as Record<string, unknown>;
        if ('buttonSelector' in passed) return config.diagnostics ?? null;
        if ('visibleClass' in passed)
            return config.neutralize?.(passed['visibleClass'] as string) ?? 0;
        return undefined;
    };
}

describe('clearBlockingOverlays()', () => {
    it('reports nothing to do when no overlay is ever visible', async ({
        assert,
    }) => {
        const page = createFakePage({
            locatorsBySelector: {
                [OVERLAY_SELECTOR]: createFakeLocator({
                    isVisible: () => false,
                }),
            },
        });

        const result = await clearBlockingOverlays(page, {
            timeoutMs: 50,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
        });
        assert.deepEqual(result, {
            dismissed: false,
            neutralized: false,
            stillBlocking: false,
            diagnostics: null,
        });
    });

    it('clicks the dismiss button and reports it dismissed an overlay', async ({
        assert,
    }) => {
        let visible = true;
        const clicked: number[] = [];
        const overlay = createFakeLocator({
            isVisible: () => visible,
            locator: (selector) => {
                assert.equal(selector, OVERLAY_BUTTON_SELECTOR);
                return createFakeLocator({
                    nth: (index) =>
                        createFakeLocator({
                            click: () => {
                                clicked.push(index);
                            },
                        }),
                });
            },
            waitFor: () => {
                visible = false;
            },
        });
        const page = createFakePage({
            locatorsBySelector: { [OVERLAY_SELECTOR]: overlay },
            evaluate: overlayEvaluate({
                diagnostics: {
                    text: 'We and our partners use cookies',
                    classes: ['modal__overlay', 'modal__overlay--visible'],
                    buttonNames: ['Accept all', 'Reject all'],
                },
            }),
        });

        const result = await clearBlockingOverlays(page, {
            timeoutMs: 500,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
        });
        assert.deepEqual(result, {
            dismissed: true,
            neutralized: false,
            stillBlocking: false,
            diagnostics: null,
        });
        // The button is addressed by the index the diagnostics read reported
        // it at, not by a name-matched locator — that alignment is the whole
        // reason both sides share OVERLAY_BUTTON_SELECTOR.
        assert.deepEqual(clicked, [0]);
    });

    it('gives up and reports it is still blocking when nothing can dismiss the overlay', async ({
        assert,
    }) => {
        const diagnostics: OverlayDiagnostics = {
            text: 'Sign in to view more jobs',
            classes: ['modal__overlay--visible'],
            buttonNames: ['Close'],
        };
        const overlay = createFakeLocator({
            isVisible: () => true,
            locator: () =>
                createFakeLocator({
                    nth: () =>
                        createFakeLocator({
                            click: () => {
                                throw new Error(
                                    'click intercepted by another overlay',
                                );
                            },
                        }),
                }),
        });
        const page = createFakePage({
            locatorsBySelector: { [OVERLAY_SELECTOR]: overlay },
            evaluate: overlayEvaluate({
                diagnostics,
                // Nothing matched the selector in the page either, so even
                // the last resort has nothing to take out of the way.
                neutralize: () => 0,
            }),
        });

        const result = await clearBlockingOverlays(page, {
            timeoutMs: 200,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
        });
        assert.equal(result.dismissed, false);
        assert.equal(result.neutralized, false);
        assert.equal(result.stillBlocking, true);
        assert.deepEqual(result.diagnostics, diagnostics);
    });

    it('dismisses via an icon-only control the old name match could never reach', async ({
        assert,
    }) => {
        let visible = true;
        const clicked: number[] = [];
        const overlay = createFakeLocator({
            isVisible: () => visible,
            locator: () =>
                createFakeLocator({
                    nth: (index) =>
                        createFakeLocator({
                            click: () => {
                                clicked.push(index);
                                visible = false;
                            },
                        }),
                }),
        });
        const page = createFakePage({
            locatorsBySelector: { [OVERLAY_SELECTOR]: overlay },
            evaluate: overlayEvaluate({
                diagnostics: {
                    ...SIGN_IN_OVERLAY,
                    // The `×` close control, unnamed — GitHub issue #27's
                    // actual overlay. Listed last so picking it can only
                    // happen by tier, not by taking the first button.
                    buttonNames: ['Sign in', 'Join now', ''],
                },
            }),
        });

        const result = await clearBlockingOverlays(page, {
            timeoutMs: 500,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
        });
        assert.equal(result.dismissed, true);
        assert.equal(result.stillBlocking, false);
        assert.deepEqual(clicked, [2]);
    });

    it('presses Escape when no control is safe to click', async ({
        assert,
    }) => {
        let visible = true;
        let clicked = false;
        const keysPressed: string[] = [];
        const overlay = createFakeLocator({
            isVisible: () => visible,
            locator: () =>
                createFakeLocator({
                    nth: () =>
                        createFakeLocator({
                            click: () => {
                                clicked = true;
                            },
                        }),
                }),
        });
        const page = createFakePage({
            locatorsBySelector: { [OVERLAY_SELECTOR]: overlay },
            evaluate: overlayEvaluate({ diagnostics: SIGN_IN_OVERLAY }),
            keyboardPress: (key) => {
                keysPressed.push(key);
                visible = false;
            },
        });

        const result = await clearBlockingOverlays(page, {
            timeoutMs: 500,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
        });
        assert.equal(result.dismissed, true);
        assert.equal(result.stillBlocking, false);
        assert.deepEqual(keysPressed, ['Escape']);
        // Sign in / Join now are the only controls: clicking either would
        // navigate the scrape off the job list.
        assert.equal(clicked, false);
    });

    it('neutralizes the overlay once maxDismissAttempts rounds have failed', async ({
        assert,
    }) => {
        let visible = true;
        let neutralizeCalls = 0;
        let strippedClass: string | null = null;
        const page = createFakePage({
            locatorsBySelector: {
                [OVERLAY_SELECTOR]: createFakeLocator({
                    isVisible: () => visible,
                }),
            },
            evaluate: overlayEvaluate({
                diagnostics: SIGN_IN_OVERLAY,
                neutralize: (visibleClass) => {
                    neutralizeCalls += 1;
                    strippedClass = visibleClass;
                    visible = false;
                    return 1;
                },
            }),
        });

        const result = await clearBlockingOverlays(page, {
            timeoutMs: 500,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
            maxDismissAttempts: 1,
        });
        assert.equal(result.dismissed, false);
        assert.equal(result.neutralized, true);
        assert.equal(result.stillBlocking, false);
        assert.deepEqual(result.diagnostics, SIGN_IN_OVERLAY);
        assert.equal(neutralizeCalls, 1);
        // It strips the `--visible` modifier itself, which is what restores
        // the element's own base `pointer-events-none` classes.
        assert.equal(strippedClass, OVERLAY_SELECTOR.slice(1));
    });

    it('emits overlay:undismissed exactly once, carrying what the overlay was', async ({
        assert,
    }) => {
        let visible = true;
        const events: ScrapeProgressEvent[] = [];
        const page = createFakePage({
            locatorsBySelector: {
                [OVERLAY_SELECTOR]: createFakeLocator({
                    isVisible: () => visible,
                }),
            },
            evaluate: overlayEvaluate({
                diagnostics: SIGN_IN_OVERLAY,
                neutralize: () => {
                    visible = false;
                    return 1;
                },
            }),
        });

        await clearBlockingOverlays(page, {
            timeoutMs: 500,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
            maxDismissAttempts: 1,
            onProgress: (event) => events.push(event),
        });

        assert.equal(events.length, 1);
        const event = events[0];
        if (!event || event.type !== 'overlay:undismissed')
            throw new Error(
                `expected one overlay:undismissed event, got ${JSON.stringify(events)}`,
            );
        assert.equal(event.neutralized, true);
        // The three fields that turn "probably a sign-in wall" into a fact.
        assert.equal(event.diagnostics?.text, 'Sign in to view more jobs');
        assert.deepEqual(event.diagnostics?.classes, SIGN_IN_OVERLAY.classes);
        assert.deepEqual(event.diagnostics?.buttonNames, [
            'Sign in',
            'Join now',
        ]);
    });

    it('leaves the overlay alone and stays blocked when neutralizeStuckOverlay is false', async ({
        assert,
    }) => {
        let neutralizeCalls = 0;
        const events: ScrapeProgressEvent[] = [];
        const page = createFakePage({
            locatorsBySelector: {
                [OVERLAY_SELECTOR]: createFakeLocator({
                    isVisible: () => true,
                }),
            },
            evaluate: overlayEvaluate({
                diagnostics: SIGN_IN_OVERLAY,
                neutralize: () => {
                    neutralizeCalls += 1;
                    return 1;
                },
            }),
        });

        const result = await clearBlockingOverlays(page, {
            timeoutMs: 200,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
            maxDismissAttempts: 1,
            neutralizeStuckOverlay: false,
            onProgress: (event) => events.push(event),
        });
        assert.equal(result.neutralized, false);
        assert.equal(result.stillBlocking, true);
        assert.equal(neutralizeCalls, 0);
        assert.deepEqual(result.diagnostics, SIGN_IN_OVERLAY);
        // Opting out of the DOM mutation must still leave the diagnostics
        // trail — that half of the fix is what identifies the overlay.
        assert.equal(events.length, 1);
        const event = events[0];
        if (!event || event.type !== 'overlay:undismissed')
            throw new Error(
                `expected one overlay:undismissed event, got ${JSON.stringify(events)}`,
            );
        assert.equal(event.neutralized, false);
    });

    it('never aims a click with diagnostics retained from an earlier round', async ({
        assert,
    }) => {
        // The button index is positional, so it only addresses the intended
        // control while the names came from *this* round's read of *this*
        // overlay. A retained read can describe a modal that is no longer the
        // first match, and replaying its index against the new one could land
        // on Sign in / Join now — the one click the picker exists to avoid.
        // So a round whose read came back null must not click at all, even
        // though the retained copy is still kept for reporting.
        let reads = 0;
        const clicked: number[] = [];
        const page = createFakePage({
            locatorsBySelector: {
                [OVERLAY_SELECTOR]: createFakeLocator({
                    isVisible: () => true,
                    locator: () =>
                        createFakeLocator({
                            nth: (index) =>
                                createFakeLocator({
                                    click: () => {
                                        clicked.push(index);
                                    },
                                }),
                        }),
                }),
            },
            evaluate: (arg?: unknown) => {
                const passed = (arg ?? {}) as Record<string, unknown>;
                if ('buttonSelector' in passed) {
                    reads += 1;
                    // Only the first read succeeds; every later one behaves
                    // like a page that navigated mid-evaluate.
                    return reads === 1
                        ? { ...SIGN_IN_OVERLAY, buttonNames: ['', 'Sign in'] }
                        : null;
                }
                if ('visibleClass' in passed) return 0;
                return undefined;
            },
        });

        const result = await clearBlockingOverlays(page, {
            timeoutMs: 300,
            pollIntervalMs: 5,
            requiredConsecutiveClear: 2,
            maxDismissAttempts: 4,
        });

        // Exactly one click, from the one round that actually read the
        // overlay — not one per round replaying index 0.
        assert.deepEqual(clicked, [0]);
        assert.equal(result.stillBlocking, true);
        // The retained copy still rides out in the report, which is what it
        // is kept for.
        assert.deepEqual(result.diagnostics?.buttonNames, ['', 'Sign in']);
    });
});
