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
        getByRole: () => locator,
        isVisible: async () => (config.isVisible ? config.isVisible() : true),
        click: async () => {
            if (config.click) await config.click();
        },
        innerText: async () => {
            if (!config.innerText)
                throw new Error('fake locator: innerText not configured');
            return config.innerText();
        },
        getAttribute: async (name: string, options?: { timeout?: number }) =>
            config.getAttribute ? config.getAttribute(name, options) : null,
        count: async () => (config.count ? config.count() : 1),
        waitFor: async () => {
            if (config.waitFor) await config.waitFor();
        },
        scrollIntoViewIfNeeded: async () => {
            if (config.scrollIntoViewIfNeeded)
                await config.scrollIntoViewIfNeeded();
        },
        allInnerTexts: async () => {
            if (!config.allInnerTexts)
                throw new Error('fake locator: allInnerTexts not configured');
            return config.allInnerTexts();
        },
    };
    return locator as unknown as Locator;
}
