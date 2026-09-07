import type { JobResult } from '../types';
import { isStaleResult } from './isStaleResult';

/** Results owed the run's existing one deferred retry pass. */
export function isRetryableResult(result: JobResult): boolean {
    return (
        isStaleResult(result) ||
        (result.status === 'failed' &&
            result.failureReason === 'detail-pane-identity-unverified')
    );
}
