import type { FailedJobResult, JobResult } from '../../src';

/** Narrows a `JobResult` to `FailedJobResult`, failing the test if it isn't one. */
export function assertFailed(
    result: JobResult,
): asserts result is FailedJobResult {
    if (result.status !== 'failed') {
        throw new Error(
            `expected a failed result, got status: ${result.status}`,
        );
    }
}
