import type { OverlayClearResult } from '../types';
import type { StaleDiagnosticsRecorder } from './createStaleDiagnostics';

/** Records one overlay clear (or a budget-skipped clear) on a job timeline. */
export function recordOverlayCheck(
    recorder: StaleDiagnosticsRecorder | undefined,
    options: {
        phase: 'pre-click' | 'post-click' | 'late';
        attempt?: number;
        startedAt: number;
        result?: OverlayClearResult;
    },
): void {
    if (!recorder) return;
    const { phase, attempt, startedAt, result } = options;
    recorder.recordOverlayCheck({
        phase,
        attempt: attempt ?? null,
        ran: result !== undefined,
        startedAt,
        elapsedMs: result ? Date.now() - startedAt : 0,
        observed: result?.observed ?? false,
        dismissed: result?.dismissed ?? false,
        neutralized: result?.neutralized ?? false,
        stillBlocking: result?.stillBlocking ?? false,
        diagnostics: result?.diagnostics ?? null,
        diagnosticsReadFailed: result?.diagnosticsReadFailed ?? false,
    });
}
