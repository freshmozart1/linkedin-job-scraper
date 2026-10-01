import { describe, it, type TestContext } from 'node:test';
import { chromium, type Response } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { runScrape, ScrapeAbortedError, SEE_MORE_BUTTON_SELECTOR, type ScrapeProgressEvent } from '../src';
import {
    createFakeBrowser,
    createFakeContext,
    createFakeLocator,
    createFakePage,
} from './helpers/fakePlaywright';

function searchRun(
    t: TestContext,
    {
        status = 200,
        landedUrl,
        onGoto,
        signal,
        maxRunDurationMs,
        onSeeMoreClick,
    }: {
        status?: number | null;
        landedUrl?: string;
        onGoto?: () => void | Promise<void>;
        signal?: AbortSignal;
        maxRunDurationMs?: number;
        onSeeMoreClick?: () => void | Promise<void>;
    } = {},
) {
    const observed = {
        browserCloses: 0,
        lookupCloses: 0,
        discoveryReads: 0,
        clickAttempts: 0,
        events: [] as ScrapeProgressEvent[],
    };
    let currentUrl = 'about:blank';
    const response = status === null
        ? null
        : { status: () => status, ok: () => status >= 200 && status < 300 } as Response;
    const searchPage = createFakePage({
        goto: async (url) => {
            currentUrl = landedUrl ?? url;
            await onGoto?.();
            return response;
        },
        url: () => currentUrl,
        defaultLocator: createFakeLocator({ isVisible: () => false }),
        locatorsBySelector: {
            [SEE_MORE_BUTTON_SELECTOR]: createFakeLocator({
                isVisible: () => onSeeMoreClick !== undefined,
                click: async () => {
                    observed.clickAttempts += 1;
                    await onSeeMoreClick?.();
                },
            }),
        },
        evaluate: () => {
            observed.discoveryReads += 1;
            return [];
        },
    });
    const searchContext = createFakeContext({ newPage: () => searchPage });
    const companyContext = createFakeContext({
        close: () => { observed.lookupCloses += 1; },
    });
    let contexts = 0;
    const browser = createFakeBrowser({
        newContext: () => contexts++ === 0 ? searchContext : companyContext,
        close: () => { observed.browserCloses += 1; },
    });
    t.mock.method(chromium, 'launch', async () => browser);

    const outcome = runScrape({
        searchParams: { keyword: 'navigation regression' },
        signal,
        scraperOptions: {
            headless: true,
            maxRunDurationMs,
            stableScrollsToStop: 1,
            clickRetryAttempts: 2,
            overlayClear: { requiredConsecutiveClear: 1 },
            staleDiagnostics: { enabled: false },
        },
        onProgress: (event) => observed.events.push(event),
    });
    return { observed, outcome };
}

function assertCleanedUpBeforeDiscovery(
    t: TestContext,
    observed: ReturnType<typeof searchRun>['observed'],
): void {
    t.assert.equal(observed.browserCloses, 1);
    t.assert.equal(observed.lookupCloses, 1);
    t.assert.equal(observed.discoveryReads, 0);
    t.assert.deepEqual(observed.events, []);
}

describe('runScrape initial search navigation', () => {
    for (const status of [403, 429, 500]) {
        it(`rejects HTTP ${status} instead of reporting zero jobs and cleans up`, async (t: TestContext) => {
            const { observed, outcome } = searchRun(t, { status });

            await t.assert.rejects(
                outcome,
                new RegExp(`LinkedIn search navigation failed: HTTP ${status}`),
            );
            assertCleanedUpBeforeDiscovery(t, observed);
        });
    }

    it('rejects a navigation without an HTTP response and cleans up', async (t: TestContext) => {
        const { observed, outcome } = searchRun(t, { status: null });

        await t.assert.rejects(outcome, /returned no HTTP response/);
        assertCleanedUpBeforeDiscovery(t, observed);
    });

    for (const landedUrl of [
        'https://www.linkedin.com/authwall?sessionRedirect=private-value',
        'https://de.linkedin.com/checkpoint/challenge',
        'https://www.linkedin.com/login',
        'https://example.test/jobs/search',
    ]) {
        it(`rejects an HTTP 200 navigation to ${new URL(landedUrl).pathname}`, async (t: TestContext) => {
            const { observed, outcome } = searchRun(t, { landedUrl });

            await t.assert.rejects(outcome, (error: unknown) => {
                t.assert.ok(error instanceof Error);
                t.assert.match(error.message, /did not reach the guest search page/);
                t.assert.equal(error.message.includes('private-value'), false);
                return true;
            });
            assertCleanedUpBeforeDiscovery(t, observed);
        });
    }

    for (const landedUrl of [
        'https://www.linkedin.com/jobs/search?keywords=nothing',
        'https://de.linkedin.com/jobs/search/?keywords=nothing&locale=de_DE',
    ]) {
        it(`keeps a valid HTTP 200 empty search on ${new URL(landedUrl).hostname} successful`, async (t: TestContext) => {
            const { observed, outcome } = searchRun(t, { landedUrl });

            const result = await outcome;

            t.assert.deepEqual(result.results, []);
            t.assert.equal(result.stoppedEarly, undefined);
            t.assert.deepEqual(observed.events, [{ type: 'jobs:found', total: 0 }]);
            t.assert.ok(observed.discoveryReads > 0);
            t.assert.equal(observed.browserCloses, 1);
            t.assert.equal(observed.lookupCloses, 1);
        });
    }

    it('preserves caller cancellation during a failed navigation', async (t: TestContext) => {
        const controller = new AbortController();
        const { observed, outcome } = searchRun(t, {
            status: 403,
            signal: controller.signal,
            onGoto: () => controller.abort(),
        });

        await t.assert.rejects(outcome, ScrapeAbortedError);
        assertCleanedUpBeforeDiscovery(t, observed);
    });

    it('preserves run-budget expiry during a failed navigation', async (t: TestContext) => {
        const { observed, outcome } = searchRun(t, {
            status: 403,
            maxRunDurationMs: 1,
            onGoto: () => sleep(20),
        });

        const result = await outcome;

        t.assert.equal(result.stoppedEarly, 'run-time-budget');
        t.assert.deepEqual(result.results, []);
        assertCleanedUpBeforeDiscovery(t, observed);
    });

    it('keeps caller cancellation ahead of run-budget expiry after navigation', async (t: TestContext) => {
        const controller = new AbortController();
        const { observed, outcome } = searchRun(t, {
            status: 403,
            signal: controller.signal,
            maxRunDurationMs: 1,
            onGoto: async () => {
                await sleep(20);
                controller.abort();
            },
        });

        await t.assert.rejects(outcome, ScrapeAbortedError);
        assertCleanedUpBeforeDiscovery(t, observed);
    });
});

describe('runScrape discovery click failures', () => {
    it('reports caller abort with a partial outcome and closes both browser contexts', async (t: TestContext) => {
        const controller = new AbortController();
        const { observed, outcome } = searchRun(t, {
            signal: controller.signal,
            onSeeMoreClick: () => {
                controller.abort();
                throw new Error('locator.click: Timeout 4000ms exceeded');
            },
        });

        await t.assert.rejects(outcome, (error: unknown) => {
            t.assert.ok(error instanceof ScrapeAbortedError);
            t.assert.deepEqual(error.partial.results, []);
            t.assert.match(error.partial.url, /linkedin\.com\/jobs\/search/);
            t.assert.equal(error.partial.stoppedEarly, undefined);
            return true;
        });
        t.assert.equal(observed.clickAttempts, 1);
        t.assert.equal(observed.browserCloses, 1);
        t.assert.equal(observed.lookupCloses, 1);
        t.assert.deepEqual(observed.events, []);
    });

    it('resolves the stopped-early outcome when the run timer expires during a failing click', async (t: TestContext) => {
        const timer = new AbortController();
        t.mock.method(AbortSignal, 'timeout', () => timer.signal);
        const { observed, outcome } = searchRun(t, {
            maxRunDurationMs: 1500,
            onSeeMoreClick: () => {
                timer.abort();
                throw new Error('locator.click: Timeout 4000ms exceeded');
            },
        });

        const result = await outcome;

        t.assert.equal(result.stoppedEarly, 'run-time-budget');
        t.assert.deepEqual(result.results, []);
        t.assert.match(result.url, /linkedin\.com\/jobs\/search/);
        t.assert.equal(observed.clickAttempts, 1);
        t.assert.equal(observed.browserCloses, 1);
        t.assert.equal(observed.lookupCloses, 1);
        t.assert.deepEqual(observed.events, []);
    });

    it('keeps caller-abort precedence when the run timer also expires during a failing click', async (t: TestContext) => {
        const controller = new AbortController();
        const timer = new AbortController();
        t.mock.method(AbortSignal, 'timeout', () => timer.signal);
        const { observed, outcome } = searchRun(t, {
            signal: controller.signal,
            maxRunDurationMs: 1500,
            onSeeMoreClick: () => {
                timer.abort();
                controller.abort();
                throw new Error('locator.click: Timeout 4000ms exceeded');
            },
        });

        await t.assert.rejects(outcome, ScrapeAbortedError);
        t.assert.equal(observed.clickAttempts, 1);
        t.assert.equal(observed.browserCloses, 1);
        t.assert.equal(observed.lookupCloses, 1);
    });

    it('preserves a genuine click error after retries and still closes the browser', async (t: TestContext) => {
        const clickError = new Error('locator.click: button remained disabled');
        const { observed, outcome } = searchRun(t, {
            onSeeMoreClick: () => { throw clickError; },
        });

        await t.assert.rejects(outcome, (error: unknown) => error === clickError);
        t.assert.equal(observed.clickAttempts, 2);
        t.assert.equal(observed.browserCloses, 1);
        t.assert.equal(observed.lookupCloses, 1);
        t.assert.deepEqual(observed.events, []);
    });
});
