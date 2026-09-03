import type { Page } from 'playwright';
import { OVERLAY_SELECTOR, OVERLAY_VISIBLE_CLASS } from '../selectors';

// Last resort when nothing could dismiss an overlay: take it out of the way
// from the page side instead of letting every subsequent click retry into it
// (GitHub issue #27 — one undismissable overlay failed job after job, tens
// of seconds each).
//
// Removing the `--visible` modifier is not a hack bolted onto the element:
// LinkedIn's own base classes on that div are `opacity-0 invisible
// pointer-events-none`, and the modifier is what overrides them at runtime.
// Stripping it therefore restores the element's *own* hidden state rather
// than imposing a foreign one — and it makes the element stop matching
// `findVisibleOverlay`, which is what lets the caller conclude the page is
// clickable again.
//
// The inline `pointer-events: none` and `visibility: hidden` are
// belt-and-suspenders for the case where some other rule keeps the element
// painted anyway. Both are needed, not just the first: `findVisibleOverlay`
// asks Playwright `isVisible()`, which reports an element with
// `pointer-events: none` (or `opacity: 0`) as perfectly visible. Forcing only
// pointer-events would leave the page genuinely clickable while every caller
// still read `stillBlocking: true` — `dismissOverlayAfterClick` would fail the
// job, and the loop would re-neutralize every poll until its deadline, which
// is the same "tens of seconds per job" symptom this exists to end.
// `visibility: hidden` is the one thing `isVisible()` does honour.
//
// Every match is neutralized, not just `.first()`: the overlay a click
// reports as the interceptor is whichever one is topmost, so clearing only
// the first can simply promote the next one into the same role.
export async function neutralizeOverlay(page: Page): Promise<number> {
    // Runs in the browser context; this package compiles without the DOM
    // lib, so the browser globals are named through a structural cast, and
    // the selector/class are passed as an explicit (JSON-serialized)
    // evaluate() argument since page.evaluate can't close over ../selectors
    // (see hidePageSectionsAboveJobList.ts).
    const neutralized = await page.evaluate(
        ({ overlaySelector, visibleClass }) => {
            interface MinimalOverlayElement {
                classList: { remove(token: string): void };
                style: { pointerEvents: string; visibility: string };
            }
            const g = globalThis as unknown as {
                document: {
                    querySelectorAll(
                        selector: string,
                    ): ArrayLike<MinimalOverlayElement>;
                };
            };
            const overlays = Array.from(
                g.document.querySelectorAll(overlaySelector),
            );
            for (const overlay of overlays) {
                overlay.classList.remove(visibleClass);
                overlay.style.pointerEvents = 'none';
                overlay.style.visibility = 'hidden';
            }
            return overlays.length;
        },
        {
            overlaySelector: OVERLAY_SELECTOR,
            visibleClass: OVERLAY_VISIBLE_CLASS,
        },
    );
    return neutralized ?? 0;
}
