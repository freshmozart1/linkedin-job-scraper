import type { Page } from 'playwright';
import type { OverlayDiagnostics } from '../types';
import { OVERLAY_BUTTON_SELECTOR, OVERLAY_SELECTOR } from '../selectors';

/**
 * How much overlay text is kept. Long enough to identify the interstitial
 * ("Sign in to view more jobs" and its subtitle both fit), short enough
 * that a mis-scoped selector matching half the page can't bloat a progress
 * event or an error string on a `FailedJobResult`.
 */
const MAX_OVERLAY_TEXT_LENGTH = 300;

// Reads everything worth knowing about the blocking overlay in ONE
// page.evaluate: its text, its full class list, and the accessible name of
// each control inside it.
//
// One read serves two purposes, which is why it isn't split. It is the
// diagnostics GitHub issue #27 asks for — the run that produced that issue
// never learned what the overlay actually said, because it happened in an
// untouched automated browser — and it is also what
// `pickDismissButtonIndex` selects a control from. Selecting from names
// already in hand also removes the old blind `getByRole(...).click({timeout:
// 2000})` against a zero-match locator, which waited the FULL 2s before
// throwing and was the single largest consumer of the retry budget.
//
// `buttonNames` is in DOM order and matched with the same
// OVERLAY_BUTTON_SELECTOR the caller clicks through, so index `i` here and
// `overlay.locator(OVERLAY_BUTTON_SELECTOR).nth(i)` are the same element.
export async function readOverlayDiagnostics(
    page: Page,
): Promise<OverlayDiagnostics | null> {
    // Runs in the browser context; this package compiles without the DOM
    // lib, so the browser globals are named through a structural cast (see
    // collectJobIds.ts). The selectors are passed as an explicit evaluate()
    // argument — JSON-serialized, not a closure, which page.evaluate cannot
    // do — so ../selectors stays the single source for them rather than
    // being hardcoded inline the way collectJobIds.ts has to do it (see
    // hidePageSectionsAboveJobList.ts for the same idiom).
    const diagnostics = await page.evaluate(
        ({ overlaySelector, buttonSelector, maxTextLength }) => {
            interface MinimalButtonElement {
                getAttribute(name: string): string | null;
                textContent: string | null;
            }
            interface MinimalOverlayElement {
                textContent: string | null;
                classList: ArrayLike<string>;
                querySelectorAll(
                    selector: string,
                ): ArrayLike<MinimalButtonElement>;
            }
            const g = globalThis as unknown as {
                document: {
                    querySelector(
                        selector: string,
                    ): MinimalOverlayElement | null;
                };
            };
            // `.first()` in findVisibleOverlay and querySelector here both
            // mean "the first match in the DOM", so this describes the same
            // element the caller is trying to dismiss.
            const overlay = g.document.querySelector(overlaySelector);
            if (!overlay) return null;
            // A bare regex rather than the `const collapse = (raw) => …`
            // helper this used to be, and the reason is not style: esbuild
            // compiles a named function expression to `__name(fn,
            // 'collapse')`, and `page.evaluate` ships this callback to the
            // browser via `toString()`, where esbuild's `__name` helper does
            // not exist — so the whole read died with `ReferenceError:
            // __name is not defined` and the caller's `.catch(() => null)`
            // reported it as "no overlay to describe". Invisible in the
            // published package, which tsc builds, and invisible here too
            // because every call site swallows the rejection by design; it
            // surfaced only when this repo's own tsx-run diagnose-stale.ts
            // started depending on these reads. Nothing inside an evaluate
            // body may be a named function.
            const whitespace = /\s+/g;
            // textContent, never innerText: the overlay's own base classes
            // still say `invisible`, so the browser reports an empty
            // innerText for it even while it is intercepting every click —
            // the same trap the collapsed company-locations markup hits.
            const text = (overlay.textContent ?? '')
                .replace(whitespace, ' ')
                .trim()
                .slice(0, maxTextLength);
            const buttons = Array.from(
                overlay.querySelectorAll(buttonSelector),
            );
            return {
                text,
                classes: Array.from(overlay.classList),
                buttonNames: buttons.map((button) => {
                    // A present-but-empty aria-label must not shadow real
                    // text, so this is not a plain `??`.
                    const label = (button.getAttribute('aria-label') ?? '')
                        .replace(whitespace, ' ')
                        .trim();
                    return (
                        label ||
                        (button.textContent ?? '')
                            .replace(whitespace, ' ')
                            .trim()
                    );
                }),
            };
        },
        {
            overlaySelector: OVERLAY_SELECTOR,
            buttonSelector: OVERLAY_BUTTON_SELECTOR,
            maxTextLength: MAX_OVERLAY_TEXT_LENGTH,
        },
    );
    return diagnostics ?? null;
}
