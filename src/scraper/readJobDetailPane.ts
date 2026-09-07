import type { Locator, Page } from 'playwright';
import type { JobBudget } from '../types';
import {
    COMPANY_SELECTOR,
    DESCRIPTION_SELECTOR,
    DETAIL_TITLE_LINK_SELECTOR,
    LIST_COMPANY_SELECTOR,
} from '../selectors';
import { jobIdFromUrl, normalizeJobUrl } from '../url';
import { trim } from './trim';
import { isCompanyMismatch } from './isCompanyMismatch';
import { isSourceJobIdMismatch } from './isSourceJobIdMismatch';
import { checkForLateOverlay } from './checkForLateOverlay';
import type { OverlayClearSettings } from './clearBlockingOverlays';
import type { StaleDiagnosticsRecorder } from './createStaleDiagnostics';
import { readDetailPaneSnapshot } from './readDetailPaneSnapshot';

interface JobDetailPane {
    company: string;
    descriptionText: string;
    companyMismatch: boolean;
    sourceJobIdMismatch: boolean;
    lateOverlayDetected: boolean;
}

/**
 * How much of the job's budget a DOM snapshot needs before it is worth
 * taking. `page.evaluate` accepts no timeout of its own, so this is the only
 * way the budget can be honoured here: skip the capture outright rather than
 * let a diagnostic read run on past a deadline the scrape itself is
 * respecting. Diagnostics must never turn a healthy job into a failed one.
 */
const SNAPSHOT_MIN_BUDGET_MS = 250;

// Reads the detail pane once it's loaded after the click. Unlike the list
// identity in `readJobListIdentity`, none of these fields survive a partial
// failure — scrapeJob's catch block always reports company/descriptionText
// as null regardless of how far this got — so this can simply throw without
// needing to hand anything back to the caller first.
//
// `budget` is forwarded rather than consulted here for its timeouts: every
// wait this performs belongs to `trim` or to checkForLateOverlay, and each of
// those clamps its own timeout against it. It *is* re-checked before the two
// throws below, though — `trim` swallows the rejection from a read clamped to
// 1ms and hands back `''`, so a budget that expires mid-read would otherwise
// be reported as a missing detail pane rather than as the timeout it is.
//
// `diagnostics` (optional trailing parameter, so omitting it leaves this
// byte-identical) is the one place a job's two sides can be recorded
// together: what the list card said versus what the pane actually showed,
// plus how long after the click each read happened. GitHub issue #29 needs a
// leftover pane traced to *which* previously-clicked job it belonged to, and
// only this function ever holds both halves at once.
//
// CRAP score here is driven by fallow's *estimated* (not instrumented)
// coverage defaulting to 0% for this function — it is internal, with no test
// file of its own (see CLAUDE.md), and is exercised through scrapeJob.
// fallow-ignore-next-line complexity
export async function readJobDetailPane(
    jobItem: Locator,
    page: Page,
    sourceJobId: string | null,
    overlayClear?: OverlayClearSettings,
    budget?: JobBudget,
    diagnostics?: StaleDiagnosticsRecorder,
): Promise<JobDetailPane> {
    const company = await trim<string>(jobItem, COMPANY_SELECTOR, {
        page,
        budget,
    });
    if (!company) {
        budget?.check();
        throw new Error('No company in detail pane for job');
    }
    // Recorded only once the read succeeded. The report denominator is the
    // final resultStatus, so a later failure cannot turn this partial read
    // into a successful or stale job.
    diagnostics?.record({
        detailCompany: company,
        msToCompanyRead: diagnostics.sinceClick(),
    });
    const descriptionText = await trim<string>(jobItem, DESCRIPTION_SELECTOR, {
        page,
        budget,
    });
    if (!descriptionText) {
        budget?.check();
        throw new Error('No description text found for list item');
    }
    diagnostics?.record({ msToDescriptionRead: diagnostics.sinceClick() });
    const listCompany = await trim<string>(jobItem, LIST_COMPANY_SELECTOR, {
        budget,
    });
    const companyMismatch = isCompanyMismatch({
        listCompany,
        detailCompany: company,
    });
    const detailTitleHref = await trim<string>(
        jobItem,
        DETAIL_TITLE_LINK_SELECTOR,
        { page, attr: 'href', budget },
    );
    const sourceJobIdMismatch = isSourceJobIdMismatch({
        sourceJobId,
        detailTitleHref,
        baseUrl: page.url(),
    });
    diagnostics?.record({
        // `trim` reports a missing element as `''`, which would read here as
        // "the card said the company was the empty string". `null` is this
        // record's word for "not read", so the coalesce is not cosmetic.
        listCompany: listCompany || null,
        companyMismatch,
        sourceJobIdMismatch,
        detailTitleHref: detailTitleHref || null,
        // The same normalizeJobUrl + jobIdFromUrl pipeline
        // isSourceJobIdMismatch runs internally. Repeated rather than
        // returned from there because that predicate's contract is a single
        // boolean and widening it would put a diagnostics concern into the
        // staleness rule itself — and this is the ID that names *which*
        // earlier posting a leftover pane belonged to, which the boolean can
        // never carry.
        detailJobId: jobIdFromUrl(normalizeJobUrl(detailTitleHref, page.url())),
        msToTitleHrefRead: diagnostics.sinceClick(),
    });
    // Captured as tightly against the reads as honesty allows: with both
    // mismatch flags now known and nothing else having touched the page, this
    // is the closest the markup will ever be to what the reads above saw.
    // Waiting until after checkForLateOverlay would mean snapshotting a pane
    // an overlay clear may just have mutated.
    let captured = await captureSnapshot(
        page,
        diagnostics,
        budget,
        companyMismatch || sourceJobIdMismatch,
    );
    const lateOverlay = await checkForLateOverlay(
        page,
        overlayClear,
        budget,
        diagnostics,
    );
    const lateOverlayDetected = lateOverlay.detected;
    diagnostics?.record({
        lateOverlayDetected,
    });
    // Only reached when neither mismatch fired, so nothing has been captured
    // yet: a late overlay is the remaining reason this job is suspect, and
    // `snapshotEveryJob` is the healthy baseline a suspect pane has to be
    // compared against before "this pane looks wrong" means anything.
    if (!captured)
        captured = await captureSnapshot(
            page,
            diagnostics,
            budget,
            lateOverlayDetected ||
                (diagnostics?.settings.snapshotEveryJob ?? false),
        );
    return {
        company,
        descriptionText,
        companyMismatch,
        sourceJobIdMismatch,
        lateOverlayDetected,
    };
}

/**
 * Takes the DOM snapshot when `wanted` and the settings both ask for one,
 * and reports whether it did.
 *
 * Never throws into the caller: failures become an explicit `failed` outcome
 * with the original error. This is load-bearing — a diagnostic read that
 * rejected would otherwise land in
 * scrapeJob's catch and turn a perfectly good job into a `status: 'failed'`
 * result, which is a far worse outcome than a missing snapshot.
 */
async function captureSnapshot(
    page: Page,
    diagnostics: StaleDiagnosticsRecorder | undefined,
    budget: JobBudget | undefined,
    wanted: boolean,
): Promise<boolean> {
    if (!diagnostics || !diagnostics.settings.domSnapshot || !wanted)
        return false;
    // See SNAPSHOT_MIN_BUDGET_MS: page.evaluate takes no timeout, so a job
    // that is nearly out of budget skips the capture instead of overrunning
    // the deadline every other wait in this file is clamped to.
    if ((budget?.remaining() ?? Infinity) < SNAPSHOT_MIN_BUDGET_MS) {
        diagnostics.record({
            snapshot: null,
            snapshotOutcome: 'skipped-budget',
            snapshotError: null,
        });
        return false;
    }
    try {
        const snapshot = await readDetailPaneSnapshot(
            page,
            diagnostics.settings.maxSnapshotChars,
        );
        if (!snapshot) {
            diagnostics.record({
                snapshot: null,
                snapshotOutcome: 'failed',
                snapshotError: 'Snapshot evaluation returned no data',
            });
            return false;
        }
        diagnostics.record({
            snapshot,
            snapshotOutcome: 'captured',
            snapshotError: null,
        });
        return true;
    } catch (error) {
        diagnostics.record({
            snapshot: null,
            snapshotOutcome: 'failed',
            snapshotError:
                error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
