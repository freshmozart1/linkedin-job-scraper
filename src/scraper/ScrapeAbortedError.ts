import type { ScrapeOutcome } from '../types';

/**
 * Thrown by `runScrape` when the caller's `AbortSignal` (`RunScrapeOptions.signal`)
 * is observed aborted at a checkpoint. `name` is `'AbortError'`, the same convention
 * `fetch` uses, so callers can distinguish a cancelled run from any other failure with
 * `error.name === 'AbortError'`. `partial` carries whatever `results`/`url` had
 * already been collected at that checkpoint — `results` is `[]` when the signal was
 * already aborted before the run started or aborted during job loading.
 */
export class ScrapeAbortedError extends Error {
    readonly name = 'AbortError';
    readonly partial: ScrapeOutcome;

    constructor(partial: ScrapeOutcome) {
        super('Scrape aborted');
        this.partial = partial;
    }
}
