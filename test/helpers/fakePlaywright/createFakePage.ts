import type { Page, Locator } from 'playwright';
import { createFakeLocator } from './createFakeLocator';

export interface FakePageConfig {
    /** Locator returned for an exact selector match; falls back to `defaultLocator`. */
    locatorsBySelector?: Record<string, Locator>;
    defaultLocator?: Locator;
    /**
     * page.evaluate() is called both for collectJobIds() (reads job ids from
     * the DOM) and for the scrollLoadPhase() scrollTo() side effect; the
     * latter's return value is discarded, so it's safe to only model the
     * former. Called once per page.evaluate() invocation.
     */
    evaluate?: () => unknown | Promise<unknown>;
    waitForLoadState?: () => void | Promise<void>;
    /**
     * The guest search URL the page is sitting on. LinkedIn re-renders the
     * detail pane client-side, so this never changes mid-run — which is what
     * makes it a stable base for resolving relative job hrefs.
     */
    url?: () => string;
    /** Company-page navigation. Receives the URL so tests can count and assert on loads. */
    goto?: (
        url: string,
        options?: { waitUntil?: string; timeout?: number },
    ) => void | Promise<void>;
}

export function createFakePage(config: FakePageConfig = {}): Page {
    const page = {
        locator: (selector: string) =>
            config.locatorsBySelector?.[selector] ??
            config.defaultLocator ??
            createFakeLocator(),
        url: () =>
            config.url?.() ??
            'https://www.linkedin.com/jobs/search?keywords=frontend',
        evaluate: async () => (config.evaluate ? config.evaluate() : undefined),
        waitForLoadState: async () => {
            if (config.waitForLoadState) await config.waitForLoadState();
        },
        goto: async (
            url: string,
            options?: { waitUntil?: string; timeout?: number },
        ) => {
            if (config.goto) await config.goto(url, options);
            return null;
        },
    };
    return page as unknown as Page;
}
