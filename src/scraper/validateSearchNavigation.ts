import type { Response } from 'playwright';
import { validateSearchDestination } from './validateSearchDestination';

// HTTP errors still resolve page.goto. Check before discovery can mistake
// an error or sign-in document without cards for a successful empty search.
export function validateSearchNavigation(
    response: Response | null,
    landedUrl: string,
    requestedUrl: string,
): void {
    if (!response) {
        throw new Error(
            'LinkedIn search navigation returned no HTTP response; guest search results could not be verified.',
        );
    }
    if (!response.ok()) {
        throw new Error(
            `LinkedIn search navigation failed: HTTP ${response.status()}. Retry later or check LinkedIn guest access.`,
        );
    }

    validateSearchDestination(landedUrl, requestedUrl);
}
