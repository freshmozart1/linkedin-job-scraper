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
    return [
        // Already collapsed and length-capped at the source (see
        // readOverlayDiagnostics), so it goes in as read.
        `overlay text: "${diagnostics.text}"`,
        `classes: [${capped(diagnostics.classes).join(' ')}]`,
        `buttons: [${capped(diagnostics.buttonNames).map(quote).join(', ')}]`,
    ].join('; ');
}

/**
 * Caps a list the same way `readOverlayDiagnostics` caps the overlay text,
 * and for the same reason: a mis-scoped selector matching half the page
 * reports hundreds of `button, [role="button"]` names, and this string ends
 * up verbatim in a `FailedJobResult`'s `error` field. Capping only the text
 * while the lists stayed unbounded left the bloat the cap was added to
 * prevent.
 */
function capped(values: string[]): string[] {
    if (values.length <= MAX_LISTED_VALUES) return values;
    const kept = values.slice(0, MAX_LISTED_VALUES);
    return [...kept, `+${values.length - MAX_LISTED_VALUES} more`];
}

const MAX_LISTED_VALUES = 12;
const MAX_VALUE_LENGTH = 60;

/** Quoted, truncated, and with any inner quote escaped so one name can't read as two. */
function quote(value: string): string {
    const clipped =
        value.length > MAX_VALUE_LENGTH
            ? `${value.slice(0, MAX_VALUE_LENGTH)}…`
            : value;
    return `"${clipped.replace(/"/g, '\\"')}"`;
}
