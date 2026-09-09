import type { Page, Locator } from 'playwright';
import { OVERLAY_SELECTOR } from '../selectors';

// LinkedIn's guest pages block all clicks behind a `.modal__overlay--visible`
// (the cookie consent banner on load, later a "Sign in to view more jobs"
// nag). Both share the same overlay/dialog structure with a dismiss-style
// button (Reject / Accept / Dismiss), so one generic poll-and-click routine
// handles both instead of hardcoding to one specific dialog.
//
// The overlay can render asynchronously (a beat after `domcontentloaded`),
// so this polls rather than checking once — it only concludes "nothing to
// dismiss" after several consecutive not-visible reads, not on the first one.
export async function findVisibleOverlay(page: Page): Promise<Locator | null> {
    // OVERLAY_SELECTOR (`.modal__overlay--visible`) is the class LinkedIn
    // actually toggles to make an overlay block pointer events (confirmed via
    // computed style: opacity 1, visibility visible, pointer-events auto). A
    // broader `[role="dialog"]` / `[role="alert"]` selector also matches
    // unrelated, always-visible accessibility live-regions that appear earlier
    // in the DOM, which made `.first()` pick the wrong element — so this stays
    // narrow on purpose.
    //
    // Imported, not hardcoded: this is not inside a page.evaluate, so it has
    // no reason to duplicate the string the way collectJobListState.ts must. It
    // also has to stay the same string readOverlayDiagnostics and
    // neutralizeOverlay are given, or this would report an overlay those two
    // can't see.
    const overlay = page.locator(OVERLAY_SELECTOR).first();
    return (await overlay.isVisible().catch(() => false)) ? overlay : null;
}
