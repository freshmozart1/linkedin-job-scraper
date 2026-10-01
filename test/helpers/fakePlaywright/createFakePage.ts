import type { Page, Locator, Response } from 'playwright';
import { createFakeLocator } from './createFakeLocator';

export interface FakePageConfig {
    /** Locator returned for an exact selector match; falls back to `defaultLocator`. */
    locatorsBySelector?: Record<string, Locator>;
    defaultLocator?: Locator;
    /**
     * page.evaluate() is called for several distinct shapes across the
     * scraper: collectJobListState()-style reads (no arg), scrollLoadPhase()'s
     * one-time hide-sections call (return value unused), and its per-<li>
     * scroll calls (the <li> index as an explicit numeric arg, expecting
     * `{ height, renderedCount }` back — `height` is `null` past the
     * currently-rendered range, `renderedCount` is the live list length).
     * Receives the real `arg` Playwright would pass so a test's config can
     * dispatch on it (e.g. `typeof arg === 'number'`) instead of one
     * generic stub being misinterpreted by every call shape. Called once
     * per page.evaluate() invocation.
     */
    evaluate?: (
        arg?: unknown,
        pageFunction?: unknown,
    ) => unknown | Promise<unknown>;
    /**
     * Receives the `(state, options)` the scraper passes, so tests can assert
     * the networkidle wait is clamped to the job's remaining time budget.
     * Widened additively — a config declaring no parameters is still
     * assignable.
     */
    waitForLoadState?: (
        state?: string,
        options?: { timeout?: number },
    ) => void | Promise<void>;
    /**
     * The guest search URL the page is sitting on. LinkedIn re-renders the
     * detail pane client-side, so this never changes mid-run — which is what
     * makes it a stable base for resolving relative job hrefs.
     */
    url?: () => string;
    /** Navigation, including an optional HTTP response for search validation. */
    goto?: (
        url: string,
        options?: { waitUntil?: string; timeout?: number },
    ) => Response | null | void | Promise<Response | null | void>;
    /**
     * Backs `page.keyboard.press(key)` — clearBlockingOverlays' Escape
     * fallback. Left unconfigured, `page.keyboard` is absent entirely, which
     * is itself worth exercising: the production code has to survive a page
     * with no usable keyboard (one torn down mid-clear) rather than letting
     * a failed fallback abort the whole clear attempt.
     */
    keyboardPress?: (key: string) => void | Promise<void>;
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
        evaluate: async (pageFunction?: unknown, arg?: unknown) =>
            config.evaluate ? config.evaluate(arg, pageFunction) : undefined,
        waitForLoadState: async (
            state?: string,
            options?: { timeout?: number },
        ) => {
            if (config.waitForLoadState)
                await config.waitForLoadState(state, options);
        },
        goto: async (
            url: string,
            options?: { waitUntil?: string; timeout?: number },
        ) => {
            return (await config.goto?.(url, options)) ?? null;
        },
        // Only present when configured, mirroring a real page whose keyboard
        // has gone away — see FakePageConfig.keyboardPress.
        ...(config.keyboardPress
            ? {
                  keyboard: {
                      press: async (key: string) => {
                          await config.keyboardPress?.(key);
                      },
                  },
              }
            : {}),
    };
    return page as unknown as Page;
}
