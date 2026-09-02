import { describe, it } from 'node:test';
import { pickDismissButtonIndex } from '../src';

describe('pickDismissButtonIndex()', () => {
    it('returns null for an overlay with no controls at all', async ({
        assert,
    }) => {
        assert.equal(pickDismissButtonIndex([]), null);
    });

    it('prefers a dismiss-named control over an icon-only one', async ({
        assert,
    }) => {
        // The icon-only button comes first in DOM order, so this can only
        // pass if tier 1 is scanned across every name before tier 2 is
        // considered at all.
        assert.equal(pickDismissButtonIndex(['', 'Close']), 1);
        assert.equal(pickDismissButtonIndex(['', 'Reject all']), 1);
    });

    it('prefers an icon-only control over an unrelated named one', async ({
        assert,
    }) => {
        // GitHub issue #27's actual failure: the close control is an
        // icon-only `×` with no accessible name, which the old
        // /reject|dismiss|accept/ match could never reach.
        assert.equal(pickDismissButtonIndex(['See more options', '']), 1);
    });

    it('matches a bare × glyph as a dismiss control', async ({ assert }) => {
        assert.equal(pickDismissButtonIndex(['Sign in', '×']), 1);
    });

    it('matches localized German dismiss names', async ({ assert }) => {
        assert.equal(pickDismissButtonIndex(['Schließen']), 0);
        assert.equal(pickDismissButtonIndex(['Schliessen']), 0);
        assert.equal(pickDismissButtonIndex(['Alle ablehnen']), 0);
        assert.equal(pickDismissButtonIndex(['Akzeptieren']), 0);
        assert.equal(pickDismissButtonIndex(['Zurück']), 0);
        assert.equal(pickDismissButtonIndex(['Später']), 0);
    });

    it('falls back to a control that would not navigate off the search page', async ({
        assert,
    }) => {
        assert.equal(pickDismissButtonIndex(['Join now', 'Maybe later']), 1);
    });

    it('returns null when only sign-in controls are on offer', async ({
        assert,
    }) => {
        // The deliberate narrowing of the issue's "fall back to any button":
        // clicking one of these navigates the scrape off the job list, which
        // is worse than the overlay it was trying to clear.
        assert.equal(pickDismissButtonIndex(['Sign in']), null);
        assert.equal(pickDismissButtonIndex(['Join now']), null);
        assert.equal(pickDismissButtonIndex(['Anmelden', 'Registrieren']), null);
        assert.equal(pickDismissButtonIndex(['Continue with Google']), null);
    });

    it('does not read "back" out of an unrelated word like Feedback', async ({
        assert,
    }) => {
        // A leading \b is what keeps `back` from matching `Feedback`; without
        // it this would rank a feedback link as the best dismiss control.
        assert.equal(pickDismissButtonIndex(['Sign in', 'Feedback']), 1);
        assert.equal(pickDismissButtonIndex(['Feedback', '']), 1);
    });
});
