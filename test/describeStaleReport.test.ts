import { describe, it } from 'node:test';
import { describeStaleReport, summarizeStaleDiagnostics } from '../src';
import { makeStaleDiagnostics } from './helpers/makeStaleDiagnostics';

describe('describeStaleReport()', () => {
    it('renders the headline counts, every combination and the co-occurrence table', ({
        assert,
    }) => {
        const timedOut = {
            outcome: 'timedOut' as const,
            elapsedMs: 8000,
            timeoutMs: 8000,
        };
        const rendered = describeStaleReport(
            summarizeStaleDiagnostics([
                makeStaleDiagnostics({
                    index: 0,
                    combination: 'company+sourceJobId',
                    titleLinkWait: timedOut,
                }),
                makeStaleDiagnostics({ index: 1 }),
                makeStaleDiagnostics({ index: 2, resultStatus: 'failed' }),
            ]),
        );

        assert.match(
            rendered,
            /records: 3 \(2 successful first-pass jobs\)/,
        );
        assert.match(rendered, /stale: 1 of 2 \(50\.0%\)/);
        assert.match(rendered, /retries: 0 attempted, 0 recovered/);
        assert.match(
            rendered,
            /identity recovery: 0 attempted, 0 recovered, 0 failed/,
        );
        assert.match(
            rendered,
            /flag combinations \(of 2 successful first-pass jobs\)/,
        );
        assert.match(rendered, /company\+sourceJobId\s+1/);
        // Printed even at zero: "this combination never occurred" is one of
        // the questions the report exists to answer, and an omitted row
        // answers it only by absence.
        assert.match(rendered, /company\+lateOverlay\s+0/);
        assert.match(
            rendered,
            /titleLinkWait:timedOut\s+with 1\/1 \(100\.0%\)\s+·\s+without 0\/1 \(0\.0%\)/,
        );
        // Multi-line, unlike describeOverlayDiagnostics: this one is printed
        // to a terminal at the end of a run, not spliced into a database row.
        assert.equal(rendered.includes('\n'), true);
    });

    it('lists clusters only once there are any', ({ assert }) => {
        const withoutClusters = describeStaleReport(
            summarizeStaleDiagnostics([
                makeStaleDiagnostics({ index: 0, combination: 'company' }),
                makeStaleDiagnostics({ index: 1 }),
            ]),
        );
        const withClusters = describeStaleReport(
            summarizeStaleDiagnostics([
                makeStaleDiagnostics({ index: 0, combination: 'company' }),
                makeStaleDiagnostics({ index: 1, combination: 'company' }),
            ]),
        );

        assert.match(
            withoutClusters,
            /clusters of 2\+ \/ longest run\s+0 \/ 1/,
        );
        assert.equal(/@\d+×\d+/.test(withoutClusters), false);
        assert.match(withClusters, /clusters of 2\+ \/ longest run\s+1 \/ 2/);
        assert.match(withClusters, /@0×2/);
    });

    it('renders a report with no records at all', ({ assert }) => {
        const rendered = describeStaleReport(summarizeStaleDiagnostics([]));

        assert.match(
            rendered,
            /records: 0 \(0 successful first-pass jobs\)/,
        );
        // 0/0 must read as 0.0%, never as NaN%.
        assert.match(rendered, /stale: 0 of 0 \(0\.0%\)/);
        assert.equal(rendered.includes('NaN'), false);
        assert.match(rendered, /none\s+0/);
    });
});
