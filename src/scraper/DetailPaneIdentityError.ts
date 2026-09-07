export class DetailPaneIdentityError extends Error {
    readonly failureReason = 'detail-pane-identity-unverified' as const;

    constructor(expectedJobId: string, observedJobId: string | null) {
        super(
            `Detail pane identity did not match source job ID ${expectedJobId} after one immediate re-click ` +
                `(last observed detail job ID: ${observedJobId ?? 'missing or unparseable'})`,
        );
        this.name = 'DetailPaneIdentityError';
    }
}
