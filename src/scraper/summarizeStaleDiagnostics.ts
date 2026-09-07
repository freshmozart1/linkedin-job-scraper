import type {
    ConditionCoOccurrence,
    OverlayCheck,
    StaleDiagnostics,
    StaleFlagCombination,
    StaleReport,
} from '../types';

const ALL_COMBINATIONS: StaleFlagCombination[] = [
    'none',
    'company',
    'sourceJobId',
    'lateOverlay',
    'company+sourceJobId',
    'company+lateOverlay',
    'sourceJobId+lateOverlay',
    'company+sourceJobId+lateOverlay',
];

interface PositionedRecord {
    record: StaleDiagnostics;
    stale: boolean;
    followedStale: boolean;
    followedDuplicate: boolean;
    secondHalf: boolean;
}

const CONDITIONS: {
    condition: string;
    holds: (positioned: PositionedRecord) => boolean;
}[] = [
    {
        condition: 'titleLinkWait:timedOut',
        holds: (p) => p.record.titleLinkWait?.outcome === 'timedOut',
    },
    {
        condition: 'titleLinkWait:skipped',
        holds: (p) => p.record.titleLinkWait?.outcome === 'skipped',
    },
    {
        condition: 'networkIdleWait:timedOut',
        holds: (p) => p.record.networkIdleWait?.outcome === 'timedOut',
    },
    { condition: 'clickAttempts>1', holds: (p) => p.record.clickAttempts > 1 },
    overlayCondition('preClickOverlay:observed', 'pre-click'),
    overlayCondition('postClickOverlay:observed', 'post-click'),
    overlayCondition('lateOverlay:observed', 'late'),
    {
        condition: 'overlay:neutralized',
        holds: (p) => p.record.overlayChecks.some((check) => check.neutralized),
    },
    {
        condition: 'overlay:stillBlocking',
        holds: (p) => p.record.overlayChecks.some((check) => check.stillBlocking),
    },
    {
        condition: 'overlayDiagnosticsReadFailed',
        holds: (p) =>
            p.record.overlayChecks.some(
                (check) => check.diagnosticsReadFailed,
            ),
    },
    {
        condition: 'duplicateOfIdx!=null',
        holds: (p) => p.record.duplicateOfIdx !== null,
    },
    { condition: 'followedDuplicate', holds: (p) => p.followedDuplicate },
    { condition: 'followedStale', holds: (p) => p.followedStale },
    { condition: 'secondHalfOfRun', holds: (p) => p.secondHalf },
];

/** Aggregates self-describing records without inferring runs or adjacency from array order. */
export function summarizeStaleDiagnostics(
    records: StaleDiagnostics[],
): StaleReport {
    const positioned = position(records);
    const successful = positioned.filter(
        (p) =>
            p.record.pass === 'first' && p.record.resultStatus === 'success',
    );
    const stale = successful.filter((p) => p.stale);

    const byCombination = zeroedCombinations();
    for (const p of successful) byCombination[p.record.combination] += 1;

    const clusters = clustersOf(stale);
    const identityRecovery = summarizeIdentityRecovery(records);
    return {
        totalRecords: records.length,
        successfulJobs: successful.length,
        staleJobs: stale.length,
        staleRate: ratio(stale.length, successful.length),
        byCombination,
        byRunPosition: {
            firstHalf: stale.filter((p) => !p.secondHalf).length,
            secondHalf: stale.filter((p) => p.secondHalf).length,
        },
        followedDuplicate: stale.filter((p) => p.followedDuplicate).length,
        followedStale: stale.filter((p) => p.followedStale).length,
        clusters: clusters.filter((cluster) => cluster.length >= 2),
        longestCluster: clusters.reduce(
            (longest, cluster) => Math.max(longest, cluster.length),
            0,
        ),
        retriesAttempted: records.filter((record) => record.pass === 'retry')
            .length,
        retriesRecovered: countRecoveredRetries(positioned),
        identityRecovery,
        conditions: CONDITIONS.map(({ condition, holds }) =>
            coOccurrence(condition, successful, holds),
        ),
        records,
    };
}

function overlayCondition(
    condition: string,
    phase: OverlayCheck['phase'],
): { condition: string; holds: (positioned: PositionedRecord) => boolean } {
    return {
        condition,
        holds: (p) =>
            p.record.overlayChecks.some(
                (check) => check.phase === phase && check.observed,
            ),
    };
}

function zeroedCombinations(): Record<StaleFlagCombination, number> {
    const counts = {} as Record<StaleFlagCombination, number>;
    for (const combination of ALL_COMBINATIONS) counts[combination] = 0;
    return counts;
}

function ratio(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : numerator / denominator;
}

function position(records: StaleDiagnostics[]): PositionedRecord[] {
    const byIdentity = new Map<string, StaleDiagnostics>();
    for (const record of records)
        byIdentity.set(identityOf(record), record);

    return records.map((record) => {
        const previous = byIdentity.get(
            `${record.runId}:${record.pass}:${record.index - 1}`,
        );
        return {
            record,
            stale: isStaleRecord(record),
            followedStale: previous ? isStaleRecord(previous) : false,
            followedDuplicate: previous?.duplicateOfIdx != null,
            secondHalf: record.index >= Math.ceil(record.totalJobs / 2),
        };
    });
}

function identityOf(record: StaleDiagnostics): string {
    return `${record.runId}:${record.pass}:${record.index}`;
}

function isStaleRecord(record: StaleDiagnostics): boolean {
    return record.resultStatus === 'success' && record.combination !== 'none';
}

function clustersOf(
    stale: PositionedRecord[],
): { runId: string; startIndex: number; length: number }[] {
    const byRun = new Map<string, number[]>();
    for (const positioned of stale) {
        const indices = byRun.get(positioned.record.runId) ?? [];
        indices.push(positioned.record.index);
        byRun.set(positioned.record.runId, indices);
    }

    const clusters: { runId: string; startIndex: number; length: number }[] = [];
    for (const [runId, unsorted] of byRun) {
        const indices = [...new Set(unsorted)].sort((a, b) => a - b);
        let open: { runId: string; startIndex: number; length: number } | null =
            null;
        for (const index of indices) {
            if (open && open.startIndex + open.length === index) {
                open.length += 1;
            } else {
                open = { runId, startIndex: index, length: 1 };
                clusters.push(open);
            }
        }
    }
    return clusters;
}

function countRecoveredRetries(positioned: PositionedRecord[]): number {
    const retryableFirstPass = new Set(
        positioned
            .filter(
                (p) =>
                    p.record.pass === 'first' &&
                    (isStaleRecord(p.record) ||
                        isDetailIdentityFailure(p.record)),
            )
            .map((p) => `${p.record.runId}:${p.record.index}`),
    );
    return positioned.filter(
        (p) =>
            p.record.pass === 'retry' &&
            p.record.resultStatus === 'success' &&
            p.record.combination === 'none' &&
            retryableFirstPass.has(`${p.record.runId}:${p.record.index}`),
    ).length;
}

function isDetailIdentityFailure(record: StaleDiagnostics): boolean {
    const checks = record.detailIdentityChecks ?? [];
    return (
        record.resultStatus === 'failed' &&
        checks.length > 1 &&
        checks.at(-1)?.matched === false
    );
}

function summarizeIdentityRecovery(records: StaleDiagnostics[]): {
    attempted: number;
    recovered: number;
    failed: number;
} {
    const attempted = records.filter((record) =>
        (record.detailIdentityChecks ?? []).some(
            (check) => check.attempt === 'immediate-reclick',
        ),
    );
    const recovered = attempted.filter(
        (record) =>
            record.resultStatus === 'success' &&
            record.detailIdentityChecks?.at(-1)?.matched === true,
    ).length;
    return {
        attempted: attempted.length,
        recovered,
        failed: attempted.length - recovered,
    };
}

function coOccurrence(
    condition: string,
    records: PositionedRecord[],
    holds: (positioned: PositionedRecord) => boolean,
): ConditionCoOccurrence {
    const withCondition = records.filter(holds);
    const withoutCondition = records.filter((p) => !holds(p));
    return {
        condition,
        withCondition: bucket(withCondition),
        withoutCondition: bucket(withoutCondition),
    };
}

function bucket(records: PositionedRecord[]): {
    total: number;
    stale: number;
    rate: number;
} {
    const stale = records.filter((p) => p.stale).length;
    return { total: records.length, stale, rate: ratio(stale, records.length) };
}
