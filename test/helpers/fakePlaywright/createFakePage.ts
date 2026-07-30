import type { Page, Locator } from 'playwright';
import { createFakeLocator } from './createFakeLocator';

export interface FakePageConfig {
    /** Locator returned for an exact selector match; falls back to `defaultLocator`. */
    locatorsBySelector?: Record<string, Locator>;
    defaultLocator?: Locator;
    /**
     * page.evaluate() is called for several distinct shapes across the
     * scraper: collectJobIds()-style reads (no arg), scrollLoadPhase()'s
     * one-time hide-sections call (return value unused), and its per-<li>
     * scroll calls (the <li> index as an explicit numeric arg, expecting
     * `{ height, renderedCount }` back — `height` is `null` past the
     * currently-rendered range, `renderedCount` is the live list length).
     * Receives the real `arg` Playwright would pass so a test's config can
     * dispatch on it (e.g. `typeof arg === 'number'`) instead of one
     * generic stub being misinterpreted by every call shape. Called once
     * per page.evaluate() invocation.
     */
    evaluate?: (arg?: unknown) => unknown | Promise<unknown>;
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
        evaluate: async (_pageFunction?: unknown, arg?: unknown) =>
            config.evaluate ? config.evaluate(arg) : undefined,
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
