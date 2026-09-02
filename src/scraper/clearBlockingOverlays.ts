import type { Page } from 'playwright';
import type {
    OverlayClearResult,
    OverlayDiagnostics,
    ScrapeProgressEvent,
} from '../types';
import { OVERLAY_BUTTON_SELECTOR } from '../selectors';
import { findVisibleOverlay } from './findVisibleOverlay';
import { readOverlayDiagnostics } from './readOverlayDiagnostics';
import { pickDismissButtonIndex } from './pickDismissButtonIndex';
import { neutralizeOverlay } from './neutralizeOverlay';
import { sleep } from './sleep';

export interface OverlayClearOptions {
    timeoutMs?: number;
    pollIntervalMs?: number;
    requiredConsecutiveClear?: number;
    /** Failed click+Escape rounds allowed before neutralizing; see ScraperOptions.overlayClear. */
    maxDismissAttempts?: number;
    /** Whether the last-resort DOM mutation is permitted; see ScraperOptions.overlayClear. */
    neutralizeStuckOverlay?: boolean;
    /** Threaded down from RunScrapeOptions so an undismissable overlay can be reported without a logger. */
    onProgress?: (event: ScrapeProgressEvent) => void;
}

/**
 * Longest a single dismiss click may block. Deliberately much shorter than
 * the old 2s: `checkForLateOverlay` gives this whole function only 3000ms,
 * so a click allowed to eat 2s of that leaves no budget to escalate to
 * Escape, let alone to neutralizing. Clamped against the remaining budget
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
 * A Playwright timeout that can never outlive this call's own deadline.
 * Without the clamp, `checkForLateOverlay`'s 3000ms budget could be spent
 * entirely inside one click, leaving nothing for the Escape and neutralize
 * tiers below it — which is the same "one blocking wait eats everything"
 * shape as the bug being fixed. Never returns 0: Playwright reads 0 as
 * "no timeout at all".
 */
function boundedBy(deadline: number, cap: number): number {
    return Math.max(1, Math.min(cap, deadline - Date.now()));
}

// Clears whatever is blocking clicks on the page, escalating cheapest-first
// instead of repeating one blind click.
//
// GitHub issue #27: a `.modal__overlay--visible` inside
// `div.top-level-modal-container` intercepted every click at the job list,
// and this function never dismissed it. It only ever clicked
// `getByRole('button', {name: /reject|dismiss|accept/i})`, which matched
// nothing on an interstitial whose close control is an icon-only `×` — and
// a `click({timeout: 2000})` against a zero-match locator waits the FULL
// timeout before throwing, so each round burned 2s achieving nothing. The
// caller then retried into the same wall until its own budget ran out, and
// the job failed after tens of seconds. That repeated for job after job.
//
// The ladder, per round, against a still-visible overlay:
//
//   1. Read it once (readOverlayDiagnostics — one page.evaluate). That read
//      replaces the blind click: the control is now chosen from names
//      already in hand, and the same read is the diagnostics the issue asks
//      for.
//   2. Click the best control, chosen by pickDismissButtonIndex, which
//      refuses to click Sign in / Join now (navigating off the search page
//      is worse than the overlay).
//   3. Press Escape — when no control was pickable at all, and also when
//      the click left the overlay standing.
//   4. Once maxDismissAttempts rounds have failed, or the budget is nearly
//      gone, neutralize the overlay outright (neutralizeOverlay) so the run
//      continues instead of stalling.
//
// It still *polls* rather than checking once, and still requires several
// consecutive not-visible reads before concluding "clear", because the nag
// can render a beat after `domcontentloaded` — that part predates this fix
// and is unchanged.
export async function clearBlockingOverlays(
    page: Page,
    {
        timeoutMs = 15000,
        pollIntervalMs = 250,
        requiredConsecutiveClear = 4,
        maxDismissAttempts = 2,
        neutralizeStuckOverlay = true,
        onProgress,
    }: OverlayClearOptions = {},
): Promise<OverlayClearResult> {
    const deadline = Date.now() + timeoutMs;
    let dismissed = false;
    let neutralized = false;
    let diagnostics: OverlayDiagnostics | null = null;
    let consecutiveNotVisible = 0;
    let failedRounds = 0;
    let confirmedClear = false;

    while (Date.now() < deadline) {
        const overlay = await findVisibleOverlay(page);

        if (!overlay) {
            consecutiveNotVisible += 1;
            if (consecutiveNotVisible >= requiredConsecutiveClear) {
                confirmedClear = true;
                break;
            }
            await sleep(pollIntervalMs);
            continue;
        }

        consecutiveNotVisible = 0;
        // Kept across rounds: a later read can come back null (the page
        // navigated mid-evaluate), and stale-but-real diagnostics beat none
        // at all when this ends up reporting a failure.
        const read = await readOverlayDiagnostics(page).catch(() => null);
        if (read) diagnostics = read;

        // Neutralizing needs a round of its own to run in, so it triggers
        // while there is still budget left rather than after the loop has
        // already fallen out of the deadline with nothing done.
        if (
            failedRounds >= maxDismissAttempts ||
            deadline - Date.now() <= pollIntervalMs
        ) {
            if (!neutralizeStuckOverlay) break;
            const forced = await neutralizeOverlay(page).catch(() => 0);
            // Nothing matched in the page, so there is no last resort left
            // and further rounds would only repeat this. `neutralized` is
            // only ever set, never cleared: a second round finding nothing
            // must not erase the first round's real mutation.
            if (forced === 0) break;
            neutralized = true;
            // Stripping the modifier makes the element stop matching
            // OVERLAY_SELECTOR, so it is the *next* iteration's
            // findVisibleOverlay that confirms the page is clickable again;
            // this branch never claims success on its own.
            await sleep(pollIntervalMs);
            continue;
        }

        const buttonIndex = diagnostics
            ? pickDismissButtonIndex(diagnostics.buttonNames)
            : null;
        if (buttonIndex !== null) {
            await overlay
                .locator(OVERLAY_BUTTON_SELECTOR)
                .nth(buttonIndex)
                .click({ timeout: boundedBy(deadline, MAX_DISMISS_CLICK_MS) })
                .catch(() => {});
            await overlay
                .waitFor({
                    state: 'hidden',
                    timeout: boundedBy(deadline, MAX_HIDDEN_WAIT_MS),
                })
                .catch(() => {});
            if ((await findVisibleOverlay(page)) === null) {
                dismissed = true;
                continue;
            }
        }

        // Escape, whether or not a control was pickable: it costs nothing,
        // and it closes exactly the dialogs whose close control this can't
        // otherwise reach. Wrapped in try/catch rather than `.catch()`
        // because a page torn down underneath us throws on the property
        // access itself, before there is any promise to attach to — and a
        // failed fallback must not take down the whole clear attempt.
        try {
            await page.keyboard.press('Escape');
        } catch {
            /* no keyboard to press against; fall through to neutralizing */
        }

        if ((await findVisibleOverlay(page)) === null) {
            dismissed = true;
            continue;
        }

        failedRounds += 1;
        await sleep(pollIntervalMs);
    }

    // `confirmedClear` already answered this with requiredConsecutiveClear
    // reads; anything else exited on the deadline or an early break and
    // needs one authoritative look. Either way the caller gets a real
    // answer and no longer has to re-query the page itself.
    const stillBlocking = confirmedClear
        ? false
        : (await findVisibleOverlay(page)) !== null;

    if (stillBlocking && !diagnostics) {
        diagnostics = await readOverlayDiagnostics(page).catch(() => null);
    }
    // Emitted once per call, and only past the button/Escape tiers: a
    // dismissal on the ordinary path happens on virtually every guest page
    // load and would drown this signal.
    if (neutralized || stillBlocking) {
        onProgress?.({
            type: 'overlay:undismissed',
            neutralized,
            diagnostics,
        });
    }

    return {
        dismissed,
        neutralized,
        stillBlocking,
        diagnostics: neutralized || stillBlocking ? diagnostics : null,
    };
}
