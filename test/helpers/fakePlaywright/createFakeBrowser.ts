// Minimal hand-written fakes for the Playwright Browser/Page/Locator surface
// that src/scraper/ and src/companyLookup.ts actually call. Plain objects
// satisfying only the methods used, cast to the real type at the call site —
// no mocking library, no real browser.
import type { Browser, BrowserContext } from 'playwright';
import { createFakeContext } from './createFakeContext';

export interface FakeBrowserConfig {
    newContext?: () => BrowserContext;
    close?: () => void | Promise<void>;
}

export function createFakeBrowser(config: FakeBrowserConfig = {}): Browser {
    const browser = {
        newContext: async () => config.newContext?.() ?? createFakeContext(),
        close: async () => {
            if (config.close) await config.close();
        },
    };
    return browser as unknown as Browser;
}
