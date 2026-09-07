import { describe, it } from 'node:test';
import { summarizeStaleDiagnostics } from '../src';
import type { ConditionCoOccurrence, StaleFlagCombination } from '../src';
import { makeStaleDiagnostics } from './helpers/makeStaleDiagnostics';

/** Pulls one row out of the co-occurrence table, failing loudly if it isn't there. */
function condition(
    conditions: ConditionCoOccurrence[],
    name: string,
): ConditionCoOccurrence {
    const found = conditions.find((entry) => entry.condition === name);
    if (!found) throw new Error(`no such condition: ${name}`);
    return found;
}

describe('summarizeStaleDiagnostics()', () => {
    it('keys all eight flag combinations, including the ones that never occurred', ({
        assert,
    }) => {
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({ index: 0 }),
            makeStaleDiagnostics({
                index: 1,
                combination: 'company+sourceJobId',
            }),
        ]);

        // The zeros are the deliverable: GitHub issue #29 asks which
        // combinations turn out never to occur, which only a closed key set
        // can answer.
        assert.deepEqual(Object.keys(report.byCombination).sort(), [
            'company',
            'company+lateOverlay',
            'company+sourceJobId',
            'company+sourceJobId+lateOverlay',
            'lateOverlay',
            'none',
            'sourceJobId',
            'sourceJobId+lateOverlay',
        ] satisfies StaleFlagCombination[]);
        assert.equal(report.byCombination['company+sourceJobId'], 1);
        assert.equal(report.byCombination.none, 1);
        assert.equal(report.byCombination.lateOverlay, 0);
        assert.equal(report.staleJobs, 1);
        assert.equal(report.staleRate, 0.5);
    });

    it('takes every rate over successful first-pass jobs only', ({
        assert,
    }) => {
        // A job that failed before the pane could not have been flagged
        // either way, so counting it would make a run full of hard failures
        // look like a run with a low stale rate.
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({ index: 0, combination: 'company' }),
            makeStaleDiagnostics({ index: 1 }),
            makeStaleDiagnostics({ index: 2, resultStatus: 'failed' }),
            makeStaleDiagnostics({ index: 3, resultStatus: 'skipped' }),
        ]);

        assert.equal(report.totalRecords, 4);
        assert.equal(report.successfulJobs, 2);
        assert.equal(report.staleJobs, 1);
        assert.equal(report.staleRate, 0.5);
        // Sums to successfulJobs, never to totalRecords.
        const combinationTotal = Object.values(report.byCombination).reduce(
            (sum, count) => sum + count,
            0,
        );
        assert.equal(combinationTotal, 2);
    });

    it('finds maximal runs of consecutive stale indices and keeps isolated ones out of clusters', ({
        assert,
    }) => {
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({ index: 0 }),
            makeStaleDiagnostics({ index: 1, combination: 'company' }),
            makeStaleDiagnostics({ index: 2, combination: 'company' }),
            makeStaleDiagnostics({ index: 3, combination: 'sourceJobId' }),
            makeStaleDiagnostics({ index: 4 }),
            makeStaleDiagnostics({ index: 5, combination: 'lateOverlay' }),
        ]);

        assert.deepEqual(report.clusters, [
            { runId: 'run-1', startIndex: 1, length: 3 },
        ]);
        assert.equal(report.longestCluster, 3);
        assert.equal(report.followedStale, 2);
    });

    it('reports a longest cluster of 1 when every stale job is isolated', ({
        assert,
    }) => {
        // "Ten isolated stale jobs" and "one run of ten" must not both
        // collapse to the same number — that difference is the whole
        // clusters-or-not question.
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({ index: 0, combination: 'company' }),
            makeStaleDiagnostics({ index: 1 }),
            makeStaleDiagnostics({ index: 2, combination: 'company' }),
        ]);

        assert.deepEqual(report.clusters, []);
        assert.equal(report.longestCluster, 1);
        assert.equal(report.followedStale, 0);
    });

    it('counts stale jobs that followed a duplicate', ({ assert }) => {
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({ index: 0, duplicateOfIdx: 7 }),
            makeStaleDiagnostics({ index: 1, combination: 'company' }),
            makeStaleDiagnostics({ index: 2, combination: 'company' }),
        ]);

        assert.equal(report.followedDuplicate, 1);
        assert.equal(
            condition(report.conditions, 'followedDuplicate').withCondition
                .total,
            1,
        );
    });

    it('splits stale jobs at the midpoint of the run index range', ({
        assert,
    }) => {
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({
                index: 0,
                totalJobs: 4,
                combination: 'company',
            }),
            makeStaleDiagnostics({ index: 1, totalJobs: 4 }),
            makeStaleDiagnostics({
                index: 2,
                totalJobs: 4,
                combination: 'company',
            }),
            makeStaleDiagnostics({
                index: 3,
                totalJobs: 4,
                combination: 'company',
            }),
        ]);

        assert.deepEqual(report.byRunPosition, { firstHalf: 1, secondHalf: 2 });
        assert.equal(
            condition(report.conditions, 'secondHalfOfRun').withCondition.total,
            2,
        );
    });

    it('counts a retry as recovered only when the first pass at that index was stale', ({
        assert,
    }) => {
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({ index: 0 }),
            makeStaleDiagnostics({ index: 1, combination: 'company' }),
            makeStaleDiagnostics({ index: 2, combination: 'company' }),
            makeStaleDiagnostics({ index: 1, pass: 'retry' }),
            makeStaleDiagnostics({
                index: 2,
                pass: 'retry',
                combination: 'company',
            }),
        ]);

        assert.equal(report.retriesAttempted, 2);
        assert.equal(report.retriesRecovered, 1);
    });

    it('summarizes immediate identity recovery and credits a deferred retry after an identity failure', ({
        assert,
    }) => {
        const initialMismatch = {
            attempt: 'initial' as const,
            expectedJobId: '222',
            detailTitleHref:
                'https://www.linkedin.com/jobs/view/previous-job-111',
            detailJobId: '111',
            matched: false,
            wait: { outcome: 'timedOut' as const, elapsedMs: 8000, timeoutMs: 8000 },
        };
        const recovered = {
            attempt: 'immediate-reclick' as const,
            expectedJobId: '222',
            detailTitleHref:
                'https://www.linkedin.com/jobs/view/current-job-222',
            detailJobId: '222',
            matched: true,
            wait: { outcome: 'resolved' as const, elapsedMs: 20, timeoutMs: 8000 },
        };
        const stillMismatched = {
            ...initialMismatch,
            attempt: 'immediate-reclick' as const,
        };
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({
                index: 0,
                detailIdentityChecks: [initialMismatch, recovered],
            }),
            makeStaleDiagnostics({
                index: 1,
                resultStatus: 'failed',
                detailIdentityChecks: [initialMismatch, stillMismatched],
            }),
            makeStaleDiagnostics({ index: 1, pass: 'retry' }),
        ]);

        assert.deepEqual(report.identityRecovery, {
            attempted: 2,
            recovered: 1,
            failed: 1,
        });
        assert.equal(report.retriesAttempted, 1);
        assert.equal(report.retriesRecovered, 1);
    });

    it('never credits one run’s retry against another run’s first pass', ({
        assert,
    }) => {
        // Two runs of the same search cover the same index range, so runId is
        // required — the index alone cannot tell them apart.
        const report = summarizeStaleDiagnostics([
            // Run one: index 1 was stale and its retry came back clean.
            makeStaleDiagnostics({ index: 0 }),
            makeStaleDiagnostics({ index: 1, combination: 'company' }),
            makeStaleDiagnostics({ index: 1, pass: 'retry' }),
            // Run two: index 1 was clean throughout, and there was no retry.
            makeStaleDiagnostics({ index: 0, runId: 'run-2' }),
            makeStaleDiagnostics({ index: 1, runId: 'run-2' }),
        ]);

        assert.equal(report.retriesAttempted, 1);
        assert.equal(report.retriesRecovered, 1);
        assert.equal(report.totalRecords, 5);
    });

    it('does not let a cluster span two runs of the same search', ({
        assert,
    }) => {
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({ index: 0, runId: 'run-2' }),
            makeStaleDiagnostics({
                index: 1,
                runId: 'run-2',
                combination: 'company',
            }),
            // A second run restarts at index 0; without a run boundary its
            // index 1 would read as adjacent to the previous run's index 1.
            makeStaleDiagnostics({ index: 0 }),
            makeStaleDiagnostics({ index: 1, combination: 'company' }),
        ]);

        assert.deepEqual(report.clusters, []);
        assert.equal(report.longestCluster, 1);
        assert.equal(report.followedStale, 0);
    });

    it('reports each condition’s stale rate with it and without it', ({
        assert,
    }) => {
        const timedOut = {
            outcome: 'timedOut' as const,
            elapsedMs: 8000,
            timeoutMs: 8000,
        };
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({
                index: 0,
                combination: 'company+sourceJobId',
                titleLinkWait: timedOut,
            }),
            makeStaleDiagnostics({
                index: 1,
                combination: 'company+sourceJobId',
                titleLinkWait: timedOut,
            }),
            makeStaleDiagnostics({ index: 2 }),
            makeStaleDiagnostics({ index: 3 }),
        ]);

        // The comparison, not the raw count, is what separates a mechanism
        // from background: a condition holding for most of a run co-occurs
        // with almost everything.
        assert.deepEqual(
            condition(report.conditions, 'titleLinkWait:timedOut'),
            {
                condition: 'titleLinkWait:timedOut',
                withCondition: { total: 2, stale: 2, rate: 1 },
                withoutCondition: { total: 2, stale: 0, rate: 0 },
            },
        );
    });

    it('reports every condition the issue asks for', ({ assert }) => {
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({ index: 0 }),
        ]);

        assert.deepEqual(
            report.conditions.map((entry) => entry.condition),
            [
                'titleLinkWait:timedOut',
                'titleLinkWait:skipped',
                'networkIdleWait:timedOut',
                'clickAttempts>1',
                'preClickOverlay:observed',
                'postClickOverlay:observed',
                'lateOverlay:observed',
                'overlay:neutralized',
                'overlay:stillBlocking',
                'overlayDiagnosticsReadFailed',
                'duplicateOfIdx!=null',
                'followedDuplicate',
                'followedStale',
                'secondHalfOfRun',
            ],
        );
    });

    it('does not let retries inflate the first-pass denominator', ({
        assert,
    }) => {
        const records = Array.from({ length: 30 }, (_, index) =>
            makeStaleDiagnostics({
                index,
                combination: index === 27 ? 'company' : 'none',
            }),
        );
        records.push(makeStaleDiagnostics({ index: 27, pass: 'retry' }));

        const report = summarizeStaleDiagnostics(records);
        assert.equal(report.totalRecords, 31);
        assert.equal(report.successfulJobs, 30);
        assert.equal(report.staleJobs, 1);
        assert.equal(report.staleRate, 1 / 30);
        assert.equal(report.retriesRecovered, 1);
    });

    it('does not classify a failed result as stale even when mismatch observations exist', ({
        assert,
    }) => {
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({ index: 0, combination: 'company' }),
            makeStaleDiagnostics({
                index: 1,
                resultStatus: 'failed',
                combination: 'company+sourceJobId',
            }),
        ]);

        assert.equal(report.successfulJobs, 1);
        assert.equal(report.staleJobs, 1);
        assert.equal(report.staleRate, 1);
    });

    it('uses totalJobs and exact predecessor indices when skipped jobs create gaps', ({
        assert,
    }) => {
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({
                index: 0,
                totalJobs: 6,
                duplicateOfIdx: 9,
            }),
            makeStaleDiagnostics({
                index: 1,
                totalJobs: 6,
                resultStatus: 'skipped',
                duplicateOfIdx: null,
            }),
            makeStaleDiagnostics({
                index: 4,
                totalJobs: 6,
                combination: 'company',
            }),
        ]);

        assert.deepEqual(report.byRunPosition, {
            firstHalf: 0,
            secondHalf: 1,
        });
        assert.equal(report.followedDuplicate, 0);
        assert.equal(report.followedStale, 0);
    });

    it('separates concatenated runs by runId even when their indices overlap', ({
        assert,
    }) => {
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({ index: 0, runId: 'run-a' }),
            makeStaleDiagnostics({
                index: 1,
                runId: 'run-a',
                combination: 'company',
            }),
            makeStaleDiagnostics({
                index: 1,
                runId: 'run-b',
                combination: 'company',
            }),
            makeStaleDiagnostics({ index: 0, runId: 'run-b' }),
        ]);

        assert.equal(report.staleJobs, 2);
        assert.equal(report.followedStale, 0);
        assert.deepEqual(report.clusters, []);
    });

    it('correlates overlay observations from every phase', ({ assert }) => {
        const overlayCheck = {
            attempt: null,
            ran: true,
            startedAt: 1,
            elapsedMs: 2,
            observed: true,
            dismissed: true,
            neutralized: false,
            stillBlocking: false,
            diagnostics: null,
            diagnosticsReadFailed: false,
        };
        const report = summarizeStaleDiagnostics([
            makeStaleDiagnostics({
                index: 0,
                combination: 'lateOverlay',
                overlayChecks: [
                    { ...overlayCheck, phase: 'pre-click', attempt: 1 },
                    { ...overlayCheck, phase: 'post-click' },
                    { ...overlayCheck, phase: 'late' },
                ],
            }),
        ]);

        for (const name of [
            'preClickOverlay:observed',
            'postClickOverlay:observed',
            'lateOverlay:observed',
        ]) {
            assert.equal(
                condition(report.conditions, name).withCondition.total,
                1,
            );
        }
    });

    it('handles an empty input without dividing by zero', ({ assert }) => {
        const report = summarizeStaleDiagnostics([]);

        assert.equal(report.totalRecords, 0);
        assert.equal(report.successfulJobs, 0);
        assert.equal(report.staleJobs, 0);
        assert.equal(report.staleRate, 0);
        assert.equal(report.longestCluster, 0);
        assert.deepEqual(report.clusters, []);
        assert.deepEqual(report.byRunPosition, { firstHalf: 0, secondHalf: 0 });
        assert.equal(Object.keys(report.byCombination).length, 8);
        // NaN survives a JSON round-trip as null and silently poisons every
        // later comparison, so no rate may ever be one.
        for (const entry of report.conditions) {
            assert.equal(Number.isNaN(entry.withCondition.rate), false);
            assert.equal(Number.isNaN(entry.withoutCondition.rate), false);
            assert.equal(entry.withCondition.rate, 0);
            assert.equal(entry.withoutCondition.rate, 0);
        }
    });

    it('keeps the records it was given, so a written-out report is self-contained', ({
        assert,
    }) => {
        const records = [makeStaleDiagnostics({ index: 0 })];
        assert.deepEqual(summarizeStaleDiagnostics(records).records, records);
    });
});
