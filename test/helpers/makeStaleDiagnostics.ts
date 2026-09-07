import type { StaleDiagnostics, StaleFlagCombination } from '../../src';

/**
 * Builds one `StaleDiagnostics` record, defaulted to a healthy job whose
 * detail pane was read cleanly.
 *
 * `resultStatus` is successful by default because the report's headline
 * denominator is successful first-pass jobs. Tests for failed and skipped
 * attempts override it explicitly.
 *
 * `combination` is passed in rather than derived from the three flags —
 * `createStaleDiagnostics.finalize()` owns that derivation, and re-deriving
 * it here would make these tests agree with the summarizer by construction
 * instead of by test.
 */
export function makeStaleDiagnostics(
    partial: Partial<StaleDiagnostics> & { index: number },
): StaleDiagnostics {
    const combination: StaleFlagCombination = partial.combination ?? 'none';
    return {
        runId: 'run-1',
        totalJobs: 30,
        pass: 'first',
        resultStatus: 'success',
        combination,
        companyMismatch: combination.includes('company'),
        sourceJobIdMismatch: combination.includes('sourceJobId'),
        lateOverlayDetected: combination.includes('lateOverlay'),
        sourceJobId: '111',
        listCompany: 'Acme',
        listTitle: 'Frontend Developer',
        sourceUrl: 'https://www.linkedin.com/jobs/view/frontend-at-acme-111',
        detailCompany: 'Acme',
        detailTitleHref:
            'https://de.linkedin.com/jobs/view/frontend-at-acme-111',
        detailJobId: '111',
        clickStartedAt: 1_700_000_000_000,
        clickDurationMs: 120,
        titleLinkWait: { outcome: 'resolved', elapsedMs: 40, timeoutMs: 8000 },
        networkIdleWait: {
            outcome: 'resolved',
            elapsedMs: 60,
            timeoutMs: 5000,
        },
        msToCompanyRead: 10,
        msToDescriptionRead: 20,
        msToTitleHrefRead: 30,
        clickAttempts: 1,
        overlayChecks: [],
        duplicateOfIdx: null,
        snapshot: null,
        snapshotOutcome: 'not-requested',
        snapshotError: null,
        ...partial,
    };
}
