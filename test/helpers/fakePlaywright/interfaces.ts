import type { Locator } from 'playwright';

export interface FakeLocatorConfig {
    isVisible?: () => boolean | Promise<boolean>;
    /**
     * Receives the `{ timeout }` the scraper passes, so tests can assert the
     * click is clamped to the job's remaining time budget. Widened
     * additively: a config that declares no parameter is still assignable,
     * which is why every existing `click: () => {...}` kept working.
     */
    click?: (options?: { timeout?: number }) => void | Promise<void>;
    innerText?: () => string | Promise<string>;
    /**
     * Receives the same `(name, options)` the scraper passes through, so tests
     * can assert reads are given an explicit timeout rather than silently
     * inheriting Playwright's 30s default on a missing element.
     */
    getAttribute?: (
        name: string,
        options?: { timeout?: number },
    ) => string | null | Promise<string | null>;
    count?: () => number | Promise<number>;
    /** Receives the `{ state, timeout }` the scraper passes; see `click` for why the widening is additive. */
    waitFor?: (options?: {
        state?: string;
        timeout?: number;
    }) => void | Promise<void>;
    /**
     * Receives the `{ timeout }` the scraper passes. Worth asserting on: with
     * no explicit timeout this call silently inherits Playwright's 30s
     * default, which is a third of a stuck job's worst case on its own.
     */
    scrollIntoViewIfNeeded?: (options?: {
        timeout?: number;
    }) => void | Promise<void>;
    /** Backs Locator.allInnerTexts() — the only "read every match" API this codebase uses (for tags). */
    allInnerTexts?: () => string[] | Promise<string[]>;
    /** Override for .nth(index), e.g. to return a distinct locator per job index. Defaults to returning this same locator. */
    nth?: (index: number) => Locator;
    /** Override for .locator(selector), e.g. to return a distinct locator per chained selector. Defaults to returning this same locator. */
    locator?: (selector: string) => Locator;
}

/** A single `getAttribute` call the scraper made against a job card. */
export interface AttributeRead {
    name: string;
    options?: { timeout?: number };
}
