import {
    OVERLAY_DISMISS_NAME_PATTERN,
    OVERLAY_SIGN_IN_NAME_PATTERN,
} from '../selectors';

// Picks which control inside a blocking overlay to click, given only the
// accessible names `readOverlayDiagnostics` read off it (in DOM order, so
// the returned index addresses the same element as
// `overlay.locator(OVERLAY_BUTTON_SELECTOR).nth(index)`).
//
// GitHub issue #27 asked to "fall back to any button inside the overlay
// rather than giving up when the name doesn't match". That is deliberately
// narrowed here: a sign-in interstitial's buttons are *Sign in* and *Join
// now*, and clicking one navigates the scrape off the search page — losing
// every remaining job, which is strictly worse than the stuck overlay. So
// the fallback is "any button that isn't a sign-in button", and when even
// that finds nothing the answer is `null`, which tells clearBlockingOverlays
// to escalate to Escape/neutralize instead of clicking blind.
//
// Pure and exported (like isCompanyMismatch / isSourceJobIdMismatch) so the
// whole tier ordering is unit-testable offline, with no browser and no fake
// page in the way.
//
// Tiers are global, not per-candidate: every name is scanned for a tier-1
// hit before any tier-2 candidate is considered, and so on. Within a tier
// the lowest index wins, matching the old `.first()` behavior. A name that
// matches *both* patterns (e.g. "Zurück zur Anmeldung") is treated as a
// dismiss control — an explicit dismissal verb is the stronger signal, and
// the sign-in pattern's job is only to disqualify the otherwise-anonymous
// tier-3 fallback.
export function pickDismissButtonIndex(names: string[]): number | null {
    const firstMatching = (
        predicate: (name: string) => boolean,
    ): number | null => {
        const index = names.findIndex((name) => predicate(name.trim()));
        return index === -1 ? null : index;
    };

    return (
        // 1. A name that says outright that it dismisses the overlay.
        firstMatching((name) => OVERLAY_DISMISS_NAME_PATTERN.test(name)) ??
        // 2. No name at all — the classic icon-only `×` close control, which
        //    the old name-matched click could never reach. LinkedIn's real
        //    `button.contextual-sign-in-modal__modal-dismiss` lands in tier 1
        //    or here depending on whether the locale gave it a label.
        firstMatching((name) => name === '') ??
        // 3. Anything left that won't navigate us off the search page.
        firstMatching((name) => !OVERLAY_SIGN_IN_NAME_PATTERN.test(name)) ??
        // 4. Only sign-in-style controls remain: don't click any of them.
        null
    );
}
