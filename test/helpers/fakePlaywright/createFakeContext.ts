import type { BrowserContext, Page } from 'playwright';
import { createFakePage } from './createFakePage';

export interface FakeContextConfig {
    /** Called before each company-page navigation; the lookup depends on this to keep LinkedIn serving the Locations section. */
    clearCookies?: () => void | Promise<void>;
    newPage?: () => Page;
    close?: () => void | Promise<void>;
}

export function createFakeContext(
    config: FakeContextConfig = {},
): BrowserContext {
    const context = {
        clearCookies: async () => {
            if (config.clearCookies) await config.clearCookies();
        },
        newPage: async () => config.newPage?.() ?? createFakePage(),
        close: async () => {
            if (config.close) await config.close();
        },
    };
    return context as unknown as BrowserContext;
}
