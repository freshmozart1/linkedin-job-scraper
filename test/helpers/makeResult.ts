import type { JobResult } from '../../src/types';

export function makeResult(
    partial: Partial<JobResult> & { index: number },
): JobResult {
    return {
        title: '',
        company: '',
        descriptionText: '',
        status: 'success',
        error: null,
        companyMismatch: false,
        lateOverlayDetected: false,
        sourceJobId: '',
        sourceUrl: '',
        sourceHostname: '',
        scrapedAt: '2024-01-01T00:00:00.000Z',
        duplicateOfIdx: null,
        companyUrl: '',
        companyAddresses: null,
        location: '',
        postedAt: '',
        tags: [],
        ...partial,
    };
}
