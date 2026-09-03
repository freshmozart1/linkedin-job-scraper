import type { FakeLocatorConfig } from './interfaces';
import type { Locator } from 'playwright';

export function createFakeLocator(config: FakeLocatorConfig = {}): Locator {
    const locator = {
        first: () => locator,
        last: () => locator,
        nth: (index: number) => (config.nth ? config.nth(index) : locator),
        filter: () => locator,
        locator: (selector: string) =>
            config.locator ? config.locator(selector) : locator,
        isVisible: async () => (config.isVisible ? config.isVisible() : true),
        click: async (options?: { timeout?: number }) => {
            if (config.click) await config.click(options);
        },
        innerText: async () => {
            if (!config.innerText)
                throw new Error('fake locator: innerText not configured');
            return config.innerText();
        },
        getAttribute: async (name: string, options?: { timeout?: number }) =>
            config.getAttribute ? config.getAttribute(name, options) : null,
        count: async () => (config.count ? config.count() : 1),
        waitFor: async (options?: { state?: string; timeout?: number }) => {
            if (config.waitFor) await config.waitFor(options);
        },
        scrollIntoViewIfNeeded: async (options?: { timeout?: number }) => {
            if (config.scrollIntoViewIfNeeded)
                await config.scrollIntoViewIfNeeded(options);
        },
        allInnerTexts: async () => {
            if (!config.allInnerTexts)
                throw new Error('fake locator: allInnerTexts not configured');
            return config.allInnerTexts();
        },
    };
    return locator as unknown as Locator;
}
