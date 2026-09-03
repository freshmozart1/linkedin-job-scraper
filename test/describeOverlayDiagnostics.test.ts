import { describe, it } from 'node:test';
import { describeOverlayDiagnostics } from '../src';
import type { OverlayDiagnostics } from '../src';

describe('describeOverlayDiagnostics()', () => {
    it('renders text, classes and button names on one line', async ({
        assert,
    }) => {
        const rendered = describeOverlayDiagnostics({
            text: 'Sign in to view more jobs',
            classes: ['modal__overlay', 'modal__overlay--visible'],
            buttonNames: ['Sign in', 'Join now', ''],
        });

        assert.equal(
            rendered,
            'overlay text: "Sign in to view more jobs"; ' +
                'classes: [modal__overlay modal__overlay--visible]; ' +
                'buttons: ["Sign in", "Join now", ""]',
        );
        // Single-line on purpose: this ends up verbatim in a FailedJobResult's
        // `error` field, and a multi-line value there is unreadable in exactly
        // the place someone would go looking for it.
        assert.equal(rendered.includes('\n'), false);
    });

    it('says so when the diagnostics read itself failed', async ({
        assert,
    }) => {
        // More useful than empty bracket soup that reads like "the overlay had
        // no text and no buttons".
        assert.equal(
            describeOverlayDiagnostics(null),
            'overlay diagnostics unavailable',
        );
    });

    it('caps the button list so one mis-scoped overlay cannot bloat an error string', async ({
        assert,
    }) => {
        const diagnostics: OverlayDiagnostics = {
            text: 'x',
            classes: ['modal__overlay--visible'],
            buttonNames: Array.from({ length: 40 }, (_, i) => `button ${i}`),
        };

        const rendered = describeOverlayDiagnostics(diagnostics);
        assert.equal(rendered.includes('"button 11"'), true);
        assert.equal(rendered.includes('"button 12"'), false);
        assert.equal(rendered.includes('"+28 more"'), true);
    });

    it('truncates and escapes a single runaway button name', async ({
        assert,
    }) => {
        const rendered = describeOverlayDiagnostics({
            text: 'x',
            classes: [],
            buttonNames: [`say "hi" ${'y'.repeat(200)}`],
        });

        // The inner quotes are escaped so one name can never read as two.
        assert.equal(rendered.includes('say \\"hi\\"'), true);
        assert.equal(rendered.includes('…'), true);
        assert.equal(rendered.length < 200, true);
    });
});
