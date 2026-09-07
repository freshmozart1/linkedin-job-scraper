import type { Page } from 'playwright';
import type { DetailPaneSnapshot } from '../types';
import {
    COMPANY_SELECTOR,
    DESCRIPTION_SELECTOR,
    DETAIL_PANE_SELECTOR,
    DETAIL_TITLE_LINK_SELECTOR,
    OVERLAY_SELECTOR,
} from '../selectors';

// Reads the detail pane's markup and its every topcard/overlay in ONE
// page.evaluate, for the stale diagnostics of GitHub issue #29.
//
// Modelled directly on readOverlayDiagnostics: one round-trip, selectors
// passed as an explicit serialized argument rather than closed over
// (page.evaluate serializes its callback via toString() and cannot reach
// module imports), browser globals named through a structural cast because
// this package compiles with no `dom` lib, and textContent rather than
// innerText — an element whose base classes say `invisible` reports an empty
// innerText even while it is on screen, which is exactly the state a stuck
// LinkedIn overlay is in.
//
// The href/name lists keep EVERY match in DOM order rather than `.first()`.
// That is the whole reason this exists next to readJobDetailPane, which
// reads only the first of each: if the pane is holding two topcards at once
// mid-swap, `.first()` shows one perfectly ordinary job and hides the
// finding. Stays internal (not re-exported from ./index) for the same reason
// readOverlayDiagnostics does — it is a page.evaluate body, untestable
// without a browser and useless outside its one caller.
export async function readDetailPaneSnapshot(
    page: Page,
    maxHtmlLength: number,
): Promise<DetailPaneSnapshot | null> {
    const snapshot = await page.evaluate(
        ({
            paneSelector,
            titleLinkSelector,
            companySelector,
            descriptionSelector,
            overlaySelector,
            maxLength,
        }) => {
            interface MinimalSnapshotElement {
                outerHTML: string;
                textContent: string | null;
                classList: ArrayLike<string>;
                getAttribute(name: string): string | null;
            }
            const g = globalThis as unknown as {
                document: {
                    body: MinimalSnapshotElement | null;
                    querySelector(
                        selector: string,
                    ): MinimalSnapshotElement | null;
                    querySelectorAll(
                        selector: string,
                    ): ArrayLike<MinimalSnapshotElement>;
                };
            };
            // A bare regex, deliberately not the `const collapse = (raw) =>
            // …` helper this started as. esbuild compiles a named function
            // expression to `__name(fn, 'collapse')`, and `page.evaluate`
            // ships the callback to the browser through `toString()` — where
            // esbuild's `__name` helper does not exist, so the whole
            // evaluate dies with `ReferenceError: __name is not defined`.
            // The compiled `dist/` this package publishes is built by tsc
            // and never sees it, which is exactly why it stayed invisible:
            // it only bites a caller running from source through
            // tsx/esbuild — such as this repo's own diagnose-stale.ts, where
            // it silently turned every snapshot into `null`. Nothing inside
            // an evaluate body may be a named function.
            const whitespace = /\s+/g;
            const pane = g.document.querySelector(paneSelector);
            // No pane container matched, so fall back to the whole body: a
            // snapshot of the wrong element still beats no snapshot, and the
            // empty `classes` below is what tells the reader that is what
            // happened.
            const root = pane ?? g.document.body;
            const description = g.document.querySelector(descriptionSelector);
            const descriptionText = (description?.textContent ?? '')
                .replace(whitespace, ' ')
                .trim();
            // Read across the document, not within `root`: these are exactly
            // the scopes readJobDetailPane's own reads use, so the snapshot
            // describes what those reads saw rather than a different subtree.
            // LinkedIn also renders its modals in a container of their own,
            // well outside any detail pane.
            const titleLinks = Array.from(
                g.document.querySelectorAll(titleLinkSelector),
            );
            const orgs = Array.from(
                g.document.querySelectorAll(companySelector),
            );
            const overlays = Array.from(
                g.document.querySelectorAll(overlaySelector),
            );
            return {
                // Capped here, in the browser, so a runaway pane never
                // crosses the bridge at full size — the same reason
                // readOverlayDiagnostics caps its text at the source.
                html: (root?.outerHTML ?? '')
                    .replace(whitespace, ' ')
                    .trim()
                    .slice(0, maxLength),
                classes: pane ? Array.from(pane.classList) : [],
                titleLinkHrefs: titleLinks.map(
                    (link) => link.getAttribute('href') ?? '',
                ),
                orgNames: orgs.map((org) =>
                    (org.textContent ?? '').replace(whitespace, ' ').trim(),
                ),
                hasDescription: description !== null,
                descriptionLength: descriptionText.length,
                visibleOverlayClasses: overlays.map((overlay) =>
                    Array.from(overlay.classList),
                ),
            };
        },
        {
            paneSelector: DETAIL_PANE_SELECTOR,
            titleLinkSelector: DETAIL_TITLE_LINK_SELECTOR,
            companySelector: COMPANY_SELECTOR,
            descriptionSelector: DESCRIPTION_SELECTOR,
            overlaySelector: OVERLAY_SELECTOR,
            maxLength: maxHtmlLength,
        },
    );
    return snapshot ?? null;
}
