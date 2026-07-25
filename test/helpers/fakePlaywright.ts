// Minimal hand-written fakes for the Playwright Page/Locator surface that
// src/scraper.ts actually calls. Plain objects satisfying only the methods
// used, cast to the real type at the call site — no mocking library, no
// real browser.
import type { Page, Locator } from 'playwright';

export interface FakeLocatorConfig {
  isVisible?: () => boolean | Promise<boolean>;
  click?: () => void | Promise<void>;
  innerText?: () => string | Promise<string>;
  getAttribute?: () => string | null | Promise<string | null>;
  count?: () => number | Promise<number>;
  waitFor?: () => void | Promise<void>;
  scrollIntoViewIfNeeded?: () => void | Promise<void>;
  /** Override for .nth(index), e.g. to return a distinct locator per job index. Defaults to returning this same locator. */
  nth?: (index: number) => Locator;
  /** Override for .locator(selector), e.g. to return a distinct locator per chained selector. Defaults to returning this same locator. */
  locator?: (selector: string) => Locator;
}

export function createFakeLocator(config: FakeLocatorConfig = {}): Locator {
  const locator = {
    first: () => locator,
    last: () => locator,
    nth: (index: number) => (config.nth ? config.nth(index) : locator),
    filter: () => locator,
    locator: (selector: string) => (config.locator ? config.locator(selector) : locator),
    getByRole: () => locator,
    isVisible: async () => (config.isVisible ? config.isVisible() : true),
    click: async () => {
      if (config.click) await config.click();
    },
    innerText: async () => {
      if (!config.innerText) throw new Error('fake locator: innerText not configured');
      return config.innerText();
    },
    getAttribute: async () => (config.getAttribute ? config.getAttribute() : null),
    count: async () => (config.count ? config.count() : 1),
    waitFor: async () => {
      if (config.waitFor) await config.waitFor();
    },
    scrollIntoViewIfNeeded: async () => {
      if (config.scrollIntoViewIfNeeded) await config.scrollIntoViewIfNeeded();
    },
  };
  return locator as unknown as Locator;
}

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
}

export function createFakePage(config: FakePageConfig = {}): Page {
  const page = {
    locator: (selector: string) => config.locatorsBySelector?.[selector] ?? config.defaultLocator ?? createFakeLocator(),
    evaluate: async () => (config.evaluate ? config.evaluate() : undefined),
    waitForLoadState: async () => {
      if (config.waitForLoadState) await config.waitForLoadState();
    },
  };
  return page as unknown as Page;
}
