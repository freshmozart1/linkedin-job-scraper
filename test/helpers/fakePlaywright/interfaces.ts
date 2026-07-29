import type { Locator } from 'playwright';

export interface FakeLocatorConfig {
    isVisible?: () => boolean | Promise<boolean>;
    click?: () => void | Promise<void>;
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
    waitFor?: () => void | Promise<void>;
    scrollIntoViewIfNeeded?: () => void | Promise<void>;
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
