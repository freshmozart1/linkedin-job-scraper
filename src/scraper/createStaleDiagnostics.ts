import type {
    DetailPaneIdentityObservation,
    OverlayCheck,
    StaleDiagnostics,
    StaleDiagnosticsOptions,
    StaleFlagCombination,
} from '../types';

/** See `StaleDiagnosticsOptions.maxSnapshotChars`. */
const DEFAULT_MAX_SNAPSHOT_CHARS = 4000;

/**
 * `StaleDiagnosticsOptions` with every snapshot switch resolved, so the one
 * place that reads them (`readJobDetailPane`) never re-applies a default of
 * its own. `enabled` is deliberately absent: it is decided one level up, by
 * whether a recorder exists at all. That keeps collection out of the normal
 * path without changing the identity gate or recovery behavior.
 */
export interface StaleDiagnosticsSettings {
    domSnapshot: boolean;
    snapshotEveryJob: boolean;
    maxSnapshotChars: number;
}

/**
 * The mutable per-job recorder threaded through the scrape, exactly the way
 * `JobBudget` is.
 *
 * Mutable-and-assigned-into rather than returned-on-success on purpose,
 * mirroring `readJobListIdentity`'s `identity` object: a job that throws
 * partway still has to hand back what it observed, and by far the most
 * interesting jobs are the ones that went wrong.
 */
export interface StaleDiagnosticsRecorder {
    /** Resolved snapshot switches, read by `readJobDetailPane` to decide whether to capture. */
    readonly settings: StaleDiagnosticsSettings;
    /** Merges observed fields into the record under construction. Later writes win. */
    record(partial: Partial<StaleDiagnostics>): void;
    /** Appends one overlay observation without exposing the mutable record. */
    recordOverlayCheck(check: OverlayCheck): void;
    /** Adds low-level click attempts across the initial activation and recovery re-click. */
    addClickAttempts(attempts: number): void;
    /** Appends one exact detail-pane identity observation. */
    recordDetailIdentityCheck(check: DetailPaneIdentityObservation): void;
    /**
     * Milliseconds since the click *completed* — the zero point every
     * `msTo…Read` offset is measured from — or `-1` while no completed click
     * has been recorded yet. Kept here rather than at each read site so all
     * three offsets share one definition of "since the click".
     */
    sinceClick(): number;
    /** Freezes the three flags into `combination` and hands back the record. */
    finalize(): StaleDiagnostics;
}

// Builds one job's diagnostics recorder (GitHub issue #29).
//
// Created in scrapeJob right where createJobBudget is, and threaded down the
// same way — as an optional trailing parameter on each helper. A caller that
// passes none (clickLoadPhase, or anyone driving the exported scrapeJob
// directly) skips collection while retaining the same scrape decisions.
//
// This is deliberately a plain accumulator with no opinion about what a
// "stale" job is: deciding that is isStaleResult's job, and re-deriving it
// here would give the run two definitions that could drift apart.
// `combination` is a *rendering* of the same three flags the result carries,
// not a second judgement of them.
export function createStaleDiagnostics(options: {
    runId: string;
    totalJobs: number;
    index: number;
    /** Defaults to `'first'`; only `retryStaleJobs` passes `'retry'`. */
    pass?: 'first' | 'retry';
    settings?: StaleDiagnosticsOptions;
}): StaleDiagnosticsRecorder {
    const { runId, totalJobs, index, pass = 'first', settings } = options;
    // Every field starts at its "never got that far" value, so a record from
    // a job that threw on its very first read is still a complete, readable
    // StaleDiagnostics rather than a bag of undefineds.
    const record: StaleDiagnostics = {
        runId,
        totalJobs,
        index,
        pass,
        resultStatus: 'failed',
        combination: 'none',
        companyMismatch: false,
        sourceJobIdMismatch: false,
        lateOverlayDetected: false,
        sourceJobId: null,
        listCompany: null,
        listTitle: null,
        sourceUrl: null,
        detailCompany: null,
        detailTitleHref: null,
        detailJobId: null,
        clickStartedAt: -1,
        clickDurationMs: -1,
        titleLinkWait: null,
        detailIdentityChecks: [],
        networkIdleWait: null,
        msToCompanyRead: -1,
        msToDescriptionRead: -1,
        msToTitleHrefRead: -1,
        clickAttempts: 0,
        overlayChecks: [],
        duplicateOfIdx: null,
        snapshot: null,
        snapshotOutcome: 'not-requested',
        snapshotError: null,
    };

    return {
        settings: {
            domSnapshot: settings?.domSnapshot ?? false,
            snapshotEveryJob: settings?.snapshotEveryJob ?? false,
            maxSnapshotChars:
                settings?.maxSnapshotChars ?? DEFAULT_MAX_SNAPSHOT_CHARS,
        },
        record(partial: Partial<StaleDiagnostics>): void {
            Object.assign(record, partial);
        },
        recordOverlayCheck(check: OverlayCheck): void {
            record.overlayChecks.push(check);
        },
        addClickAttempts(attempts: number): void {
            record.clickAttempts += attempts;
        },
        recordDetailIdentityCheck(check: DetailPaneIdentityObservation): void {
            record.detailIdentityChecks?.push(check);
        },
        sinceClick(): number {
            // Both halves are needed: the offsets are measured from the click
            // *completing*, not from when it was issued, so that a job whose
            // click ladder had to retry against an overlay doesn't report
            // that retry time as detail-pane latency.
            if (record.clickStartedAt < 0 || record.clickDurationMs < 0)
                return -1;
            return (
                Date.now() - (record.clickStartedAt + record.clickDurationMs)
            );
        },
        finalize(): StaleDiagnostics {
            record.combination = toCombination(record);
            return record;
        },
    };
}

/**
 * Renders the three flags into one `StaleFlagCombination` key, always in the
 * order `company` → `sourceJobId` → `lateOverlay` so the eight keys the
 * report is built on are produced by construction rather than by a lookup
 * table that could drift from the union.
 */
function toCombination(flags: {
    companyMismatch: boolean;
    sourceJobIdMismatch: boolean;
    lateOverlayDetected: boolean;
}): StaleFlagCombination {
    const parts: string[] = [];
    if (flags.companyMismatch) parts.push('company');
    if (flags.sourceJobIdMismatch) parts.push('sourceJobId');
    if (flags.lateOverlayDetected) parts.push('lateOverlay');
    // The join can only ever produce one of the eight union members, but
    // TypeScript cannot see that through `string[]`, hence the assertion.
    return (
        parts.length === 0 ? 'none' : parts.join('+')
    ) as StaleFlagCombination;
}
