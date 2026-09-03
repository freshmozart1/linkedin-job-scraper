import type { Locator, Page } from 'playwright';
import type { OverlayDiagnostics } from '../types';
import { OVERLAY_BUTTON_SELECTOR } from '../selectors';
import { findVisibleOverlay } from './findVisibleOverlay';
import { pickDismissButtonIndex } from './pickDismissButtonIndex';

/**
 * Longest a single dismiss click may block. Deliberately much shorter than
 * the old 2s: `checkForLateOverlay` gives `clearBlockingOverlays` only
 * 3000ms, so a click allowed to eat 2s of that leaves no budget to escalate
 * to Escape, let alone to neutralizing. Clamped against the remaining budget
 * for the same reason.
 */
const MAX_DISMISS_CLICK_MS = 1000;

/**
 * Longest to wait for a clicked overlay to actually disappear. Also far
 * below the old 3000ms, and for the same budget reason — a modal's close
 * transition is a few hundred milliseconds, and if it hasn't gone by then
 * the next round re-reads it anyway.
 */
const MAX_HIDDEN_WAIT_MS = 500;

/**
 * A Playwright timeout that can never outlive the caller's own deadline, and
 * that can never eat the budget the tiers below it still need.
 *
 * Clamping against the deadline alone is not enough. Both of
 * `clearBlockingOverlays`' escalation triggers are only evaluated at the
 * *top* of a round, so a round that overshoots the deadline takes the whole
 * ladder down with it: at `checkForLateOverlay`'s 3000ms, two rounds of
 * `MAX_DISMISS_CLICK_MS + MAX_HIDDEN_WAIT_MS + poll` (~1700ms each) end past
 * the deadline with `failedRounds` only just reaching `maxDismissAttempts`,
 * so the round that would have neutralized never runs — the ladder's last
 * rung was unreachable for that caller. `roundsLeft` is how many dismiss
 * rounds may still run, and the `+ 1` reserves a share for the neutralize
 * round that has to follow them.
 *
 * Never returns 0: Playwright reads 0 as "no timeout at all".
 */
function boundedBy(deadline: number, cap: number, roundsLeft: number): number {
    const share = (deadline - Date.now()) / (roundsLeft + 1);
    return Math.max(1, Math.floor(Math.min(cap, share)));
}

// Tier 2 of clearBlockingOverlays' ladder: click the best dismiss control the
// overlay offers and report whether the page came back clean. Returns `false`
// both when no control was pickable and when one was clicked but the overlay
// survived — the caller treats those the same way, by falling through to the
// Escape tier.
//
// Lives in its own file because the two timing caps and `boundedBy` above are
// used by nothing else: the whole budget-clamping concern is this tier's, and
// keeping it inline made the reader of the ladder wade through it before
// reaching the rung it belongs to.
//
// `diagnostics` must be *this* round's read of *this* overlay, never a
// retained one. The index is positional, so a stale read can describe a modal
// that is no longer the first match, and its index could then land on the new
// one's Sign in / Join now — the one click pickDismissButtonIndex exists to
// avoid. Hence the parameter is non-nullable: a caller with nothing fresh to
// pass has nothing to click, and must not call this at all.
export async function clickOverlayDismissControl(
    page: Page,
    overlay: Locator,
    diagnostics: OverlayDiagnostics,
    deadline: number,
    roundsLeft: number,
): Promise<boolean> {
    const buttonIndex = pickDismissButtonIndex(diagnostics.buttonNames);
    // No control this is willing to click (or none at all). Returning before
    // the findVisibleOverlay below matters: nothing was touched, so a probe
    // here would be a round-trip that could only repeat what the caller's own
    // findVisibleOverlay already told it this round.
    if (buttonIndex === null) return false;

    await overlay
        .locator(OVERLAY_BUTTON_SELECTOR)
        .nth(buttonIndex)
        .click({
            timeout: boundedBy(deadline, MAX_DISMISS_CLICK_MS, roundsLeft),
        })
        .catch(() => {});
    await overlay
        .waitFor({
            state: 'hidden',
            timeout: boundedBy(deadline, MAX_HIDDEN_WAIT_MS, roundsLeft),
        })
        .catch(() => {});
    return (await findVisibleOverlay(page)) === null;
}
