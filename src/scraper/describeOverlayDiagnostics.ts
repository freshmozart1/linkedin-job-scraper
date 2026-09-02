import type { OverlayDiagnostics } from '../types';

// Renders overlay diagnostics into one single-line string.
//
// Single-line on purpose: this is appended to a thrown Error message, which
// ends up verbatim in a FailedJobResult's `error` field and, from there, in
// whatever log or database row the consumer keeps. A multi-line value there
// is unreadable in exactly the place someone would go looking for it — the
// list of failed jobs after a run.
//
// Pure (no Playwright import) so it is testable offline, the same way
// ../address.ts is kept free of the browser half of its own feature.
export function describeOverlayDiagnostics(
    diagnostics: OverlayDiagnostics | null,
): string {
    // The read itself can fail (the page navigated mid-evaluate), and
    // saying so is more useful than an empty bracket soup that reads like
    // "the overlay had no text and no buttons".
    if (!diagnostics) return 'overlay diagnostics unavailable';
    const quoted = (values: string[]): string =>
        values.map((value) => `"${value}"`).join(', ');
    return [
        `overlay text: "${diagnostics.text.replace(/\s+/g, ' ').trim()}"`,
        `classes: [${diagnostics.classes.join(' ')}]`,
        `buttons: [${quoted(diagnostics.buttonNames)}]`,
    ].join('; ');
}
