import type { ConditionCoOccurrence, StaleReport } from '../types';

/**
 * How many clusters are listed before the rest are summed away, and how wide
 * a label may get — the same capping idea `describeOverlayDiagnostics` uses,
 * for the same reason: a pathological run must not turn one line of a
 * summary into hundreds.
 */
const MAX_LISTED_CLUSTERS = 12;
const LABEL_WIDTH = 32;

// Renders a StaleReport as a human-readable, multi-line block.
//
// Multi-line, unlike describeOverlayDiagnostics — and the difference is not
// stylistic. That one is spliced into a thrown Error message that ends up
// verbatim in a FailedJobResult's `error` field and, from there, in a
// database row, where a newline is unreadable in exactly the place someone
// would go looking for it. This one is printed once, at the end of a
// diagnostic run, to a terminal.
//
// Pure (no Playwright import) for the same reason summarizeStaleDiagnostics
// is: the whole rendering is unit-testable with no browser in the way.
export function describeStaleReport(report: StaleReport): string {
    const lines: string[] = ['Stale scrape diagnostics'];

    lines.push(
        `  records: ${report.totalRecords} (${report.successfulJobs} successful first-pass jobs)`,
    );
    lines.push(
        `  stale: ${report.staleJobs} of ${report.successfulJobs} (${percent(report.staleRate)})`,
    );
    lines.push(
        `  retries: ${report.retriesAttempted} attempted, ${report.retriesRecovered} recovered`,
    );
    lines.push(
        `  identity recovery: ${report.identityRecovery.attempted} attempted, ${report.identityRecovery.recovered} recovered, ${report.identityRecovery.failed} failed`,
    );

    // Every combination is printed, including the ones at zero: "this
    // combination never occurred" is one of the questions GitHub issue #29
    // asks, and an omitted row answers it only by absence.
    lines.push(
        '',
        `flag combinations (of ${report.successfulJobs} successful first-pass jobs)`,
    );
    for (const [combination, count] of Object.entries(report.byCombination)) {
        lines.push(`  ${pad(combination)}${count}`);
    }

    lines.push('', 'position in run (stale jobs only)');
    lines.push(
        `  ${pad('first half / second half')}${report.byRunPosition.firstHalf} / ${report.byRunPosition.secondHalf}`,
    );
    lines.push(`  ${pad('followed a duplicate')}${report.followedDuplicate}`);
    lines.push(`  ${pad('followed a stale job')}${report.followedStale}`);
    lines.push(
        `  ${pad('clusters of 2+ / longest run')}${report.clusters.length} / ${report.longestCluster}`,
    );
    if (report.clusters.length > 0)
        lines.push(`  ${pad('clusters')}${describeClusters(report.clusters)}`);

    lines.push('', 'condition co-occurrence (stale rate with / without)');
    if (report.conditions.length === 0) lines.push('  (none)');
    for (const condition of report.conditions)
        lines.push(`  ${describeCondition(condition)}`);

    return lines.join('\n');
}

/** `withCondition` against `withoutCondition` on one line — the comparison is the whole point, so neither half is ever printed alone. */
function describeCondition(condition: ConditionCoOccurrence): string {
    const { withCondition: on, withoutCondition: off } = condition;
    return (
        `${pad(condition.condition)}` +
        `with ${on.stale}/${on.total} (${percent(on.rate)})` +
        `  ·  without ${off.stale}/${off.total} (${percent(off.rate)})`
    );
}

/** `@<startIndex>×<length>`, capped the way describeOverlayDiagnostics caps its lists. */
function describeClusters(
    clusters: { runId: string; startIndex: number; length: number }[],
): string {
    const listed = clusters
        .slice(0, MAX_LISTED_CLUSTERS)
        .map(
            (cluster) =>
                `${cluster.runId.slice(0, 8)}:@${cluster.startIndex}×${cluster.length}`,
        );
    if (clusters.length > MAX_LISTED_CLUSTERS)
        listed.push(`+${clusters.length - MAX_LISTED_CLUSTERS} more`);
    return listed.join(', ');
}

/**
 * One decimal place, so a 33.3% run reads as the third the issue reports
 * rather than rounding to a flat 33%. `toFixed` keeps the width stable,
 * which is what makes the columns line up.
 */
function percent(rate: number): string {
    return `${(rate * 100).toFixed(1)}%`;
}

/** Left-aligns a label into a fixed column, and lets a longer one overflow rather than truncating a name the reader needs whole. */
function pad(label: string): string {
    return label.padEnd(LABEL_WIDTH, ' ');
}
