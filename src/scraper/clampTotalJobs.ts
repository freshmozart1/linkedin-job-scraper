// Applied once, upstream in runScrape, to the raw count loadAllJobs
// discovers — so it propagates for free through ScrapeContext.totalJobs
// into both scrapeAllJobsOnce's loop bound and every progress event's
// `total` (see README's Progress events section: jobs:found's `total` is
// final for the run). Never expands past what was actually discovered.
// Floored at 0 so a misconfigured (0 or negative) maxJobs can't leak a
// negative `total` into the public jobs:found/job:start events.
export function clampTotalJobs(
    discoveredTotal: number,
    maxJobs: number | undefined,
): number {
    if (maxJobs === undefined) return discoveredTotal;
    return Math.max(0, Math.min(discoveredTotal, maxJobs));
}
