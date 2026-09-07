import { describe, it } from 'node:test';
import type { OverlayClearResult } from '../src';
import { createStaleDiagnostics } from '../src/scraper/createStaleDiagnostics';
import { recordOverlayCheck } from '../src/scraper/recordOverlayCheck';

const clean: OverlayClearResult = {
    observed: false,
    dismissed: false,
    neutralized: false,
    stillBlocking: false,
    diagnostics: null,
    diagnosticsReadFailed: false,
};

describe('recordOverlayCheck()', () => {
    for (const [name, result] of [
        ['no overlay', clean],
        [
            'dismissed',
            {
                ...clean,
                observed: true,
                dismissed: true,
                diagnostics: {
                    text: 'Sign in to view more jobs',
                    classes: ['modal__overlay--visible'],
                    buttonNames: ['Dismiss'],
                },
            },
        ],
        [
            'neutralized',
            { ...clean, observed: true, neutralized: true },
        ],
        [
            'still blocking',
            { ...clean, observed: true, stillBlocking: true },
        ],
        [
            'diagnostics read failed',
            {
                ...clean,
                observed: true,
                stillBlocking: true,
                diagnosticsReadFailed: true,
            },
        ],
    ] satisfies [string, OverlayClearResult][]) {
        it(`retains a ${name} result in the timeline`, ({ assert }) => {
            const recorder = createStaleDiagnostics({
                runId: 'overlay-run',
                totalJobs: 30,
                index: 4,
            });

            recordOverlayCheck(recorder, {
                phase: 'pre-click',
                attempt: 2,
                startedAt: Date.now(),
                result,
            });

            const [check] = recorder.finalize().overlayChecks;
            assert.equal(check?.phase, 'pre-click');
            assert.equal(check?.attempt, 2);
            assert.equal(check?.ran, true);
            assert.equal(check?.observed, result.observed);
            assert.equal(check?.dismissed, result.dismissed);
            assert.equal(check?.neutralized, result.neutralized);
            assert.equal(check?.stillBlocking, result.stillBlocking);
            assert.deepEqual(check?.diagnostics, result.diagnostics);
            assert.equal(
                check?.diagnosticsReadFailed,
                result.diagnosticsReadFailed,
            );
        });
    }

    it('retains a budget-skipped check distinctly from a clean check', ({
        assert,
    }) => {
        const recorder = createStaleDiagnostics({
            runId: 'overlay-run',
            totalJobs: 30,
            index: 4,
        });

        recordOverlayCheck(recorder, {
            phase: 'late',
            startedAt: Date.now(),
        });

        assert.equal(recorder.finalize().overlayChecks[0]?.ran, false);
    });
});
