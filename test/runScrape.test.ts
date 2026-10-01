import { describe, it, type TestContext } from 'node:test';
import { chromium, type Response } from 'playwright';
import { setTimeout as sleep } from 'node:timers/promises';
import { runScrape, ScrapeAbortedError, type ScrapeProgressEvent } from '../src';
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
    }: {
        status?: number | null;
        landedUrl?: string;
        onGoto?: () => void | Promise<void>;
        signal?: AbortSignal;
        maxRunDurationMs?: number;
    } = {},
) {
    const observed = {
        browserCloses: 0,
        lookupCloses: 0,
        discoveryReads: 0,
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
