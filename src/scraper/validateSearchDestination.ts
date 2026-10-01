// Kept separate from HTTP response validation because a sign-in redirect
// can finish with HTTP 200 while leaving the requested search surface.
export function validateSearchDestination(
    landedUrl: string,
    requestedUrl: string,
): void {
    const destination = new URL(landedUrl);
    const requestedPath = new URL(requestedUrl).pathname.replace(/\/$/, '');
    // Country subdomains, query changes and a trailing slash do not change
    // the guest-search surface. Authentication/challenge pages do. Do not
    // require any job cards: a legitimate search can have zero matches.
    const linkedInHost = /(^|\.)linkedin\.com$/.test(destination.hostname);
    const searchPath = destination.pathname.replace(/\/$/, '') === requestedPath;
    if (!linkedInHost || !searchPath) {
        // Query parameters can contain a redirect/session token, so report
        // only the origin and path of an unexpected destination.
        throw new Error(
            `LinkedIn search navigation did not reach the guest search page (${destination.origin}${destination.pathname}). Check LinkedIn guest access before retrying.`,
        );
    }
}
