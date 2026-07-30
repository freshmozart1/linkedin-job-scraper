import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import { createCompanyLookup } from '../src/index';
import type { CompanyLookup, RawCompanyLocation } from '../src/index';
import {
    createFakeBrowser,
    createFakeContext,
    createFakePage,
} from './helpers/fakePlaywright';

const YATTA = 'https://de.linkedin.com/company/yatta-solutions-gmbh';
const ADESSO = 'https://de.linkedin.com/company/adesso-se';

interface Recorder {
    gotos: string[];
    clearCookiesCalls: number;
}

/**
 * Builds a lookup over a fake browser. `locationsFor` answers each navigation
 * with the raw `<li>` data that page would yield — returning `[]` models the
 * page LinkedIn serves with its Locations section stripped out.
 */
function makeLookup(options: {
    locationsFor: (url: string, attempt: number) => RawCompanyLocation[];
    landsOn?: (url: string) => string;
    onGoto?: (url: string) => void;
    maxAddressesPerCompany?: number;
    emptyRetries?: number;
}): Promise<CompanyLookup> & { recorder: Recorder } {
    const recorder: Recorder = { gotos: [], clearCookiesCalls: 0 };
    const attemptsByUrl = new Map<string, number>();
    let currentUrl = 'about:blank';

    const page: Page = createFakePage({
        url: () => currentUrl,
        goto: (url) => {
            recorder.gotos.push(url);
            currentUrl = options.landsOn ? options.landsOn(url) : url;
            options.onGoto?.(url);
        },
        evaluate: () => {
            const target = recorder.gotos[recorder.gotos.length - 1] ?? '';
            const attempt = attemptsByUrl.get(target) ?? 0;
            attemptsByUrl.set(target, attempt + 1);
            return options.locationsFor(target, attempt);
        },
    });

    const context = createFakeContext({
        clearCookies: () => {
            recorder.clearCookiesCalls += 1;
        },
        newPage: () => page,
    });

    const promise = createCompanyLookup(
        createFakeBrowser({ newContext: () => context }),
        {
            delayBetweenLookupsMs: 0,
            maxAddressesPerCompany: options.maxAddressesPerCompany,
            emptyRetries: options.emptyRetries,
        },
    );
    return Object.assign(promise, { recorder });
}

function locationsOf(...cities: string[]): RawCompanyLocation[] {
    return cities.map((city, i) => ({
        isPrimary: i === 0,
        lines: [`${city} Street 1`, `${city}, DE`],
    }));
}

describe('addressesFor()', () => {
    it('parses the locations off the company page, primary first', async ({
        assert,
    }) => {
        const lookup = await makeLookup({
            locationsFor: () => locationsOf('Frankfurt', 'Kassel'),
        });

        const addresses = await lookup.addressesFor(YATTA);

        assert.deepEqual(
            addresses?.map((a) => a.city),
            ['Frankfurt', 'Kassel'],
        );
        assert.equal(addresses?.[0]?.streetAddress, 'Frankfurt Street 1');
    });

    it('clears cookies before every navigation', async ({ assert }) => {
        // Load-bearing, not hygiene: LinkedIn only serves the Locations section
        // to a cookie jar that has not already seen a company page. Without
        // this the second company onwards silently comes back with no
        // addresses at all.
        const pending = makeLookup({
            locationsFor: () => locationsOf('Frankfurt'),
        });
        const lookup = await pending;

        await lookup.addressesFor(YATTA);
        await lookup.addressesFor(ADESSO);

        assert.deepEqual(pending.recorder.gotos, [YATTA, ADESSO]);
        assert.equal(pending.recorder.clearCookiesCalls, 2);
    });

    it('serves a repeated company from cache without navigating again', async ({
        assert,
    }) => {
        const pending = makeLookup({
            locationsFor: () => locationsOf('Frankfurt'),
        });
        const lookup = await pending;

        const first = await lookup.addressesFor(YATTA);
        const second = await lookup.addressesFor(YATTA);

        assert.deepEqual(pending.recorder.gotos, [YATTA]);
        assert.deepEqual(first, second);
    });

    it('retries once when the page comes back with no locations section', async ({
        assert,
    }) => {
        // The section is served intermittently — the same company answers
        // with addresses on one load and nothing on the next.
        const pending = makeLookup({
            locationsFor: (_url, attempt) =>
                attempt === 0 ? [] : locationsOf('Frankfurt'),
        });
        const lookup = await pending;

        const addresses = await lookup.addressesFor(YATTA);

        assert.equal(pending.recorder.gotos.length, 2);
        assert.deepEqual(
            addresses?.map((a) => a.city),
            ['Frankfurt'],
        );
    });

    it('gives up with an empty array when the retry is also empty', async ({
        assert,
    }) => {
        // `[]` and null are different answers: this company was read
        // successfully and genuinely publishes nothing.
        const pending = makeLookup({ locationsFor: () => [] });
        const lookup = await pending;

        const addresses = await lookup.addressesFor(YATTA);

        assert.deepEqual(addresses, []);
        assert.equal(pending.recorder.gotos.length, 2);
    });

    it('keeps a successful empty read when the retry then fails', async ({
        assert,
    }) => {
        // A transient failure on the retry is not evidence about what the
        // company publishes — the first attempt already read the page, so
        // `[]` stands. Downgrading it to null would claim the lookup never
        // succeeded, and that null gets cached for the rest of the run.
        let gotos = 0;
        const lookup = await makeLookup({
            locationsFor: () => [],
            onGoto: () => {
                if (++gotos === 2) throw new Error('net::ERR_TIMED_OUT');
            },
        });

        assert.deepEqual(await lookup.addressesFor(YATTA), []);
    });

    it('keeps a successful empty read when the retry hits the auth wall', async ({
        assert,
    }) => {
        let gotos = 0;
        const lookup = await makeLookup({
            locationsFor: () => [],
            landsOn: (url) =>
                ++gotos === 2
                    ? 'https://www.linkedin.com/authwall?trk=bf'
                    : url,
        });

        assert.deepEqual(await lookup.addressesFor(YATTA), []);
    });

    it('honours emptyRetries: 0 by not retrying at all', async ({ assert }) => {
        const pending = makeLookup({ locationsFor: () => [], emptyRetries: 0 });
        const lookup = await pending;

        await lookup.addressesFor(YATTA);

        assert.equal(pending.recorder.gotos.length, 1);
    });

    it('returns null when LinkedIn redirects to the sign-up wall', async ({
        assert,
    }) => {
        const lookup = await makeLookup({
            locationsFor: () => locationsOf('Frankfurt'),
            landsOn: () =>
                'https://www.linkedin.com/authwall?trk=bf&sessionRedirect=x',
        });

        assert.equal(await lookup.addressesFor(YATTA), null);
    });

    it('returns null when the navigation throws', async ({ assert }) => {
        const lookup = await makeLookup({
            locationsFor: () => locationsOf('Frankfurt'),
            onGoto: () => {
                throw new Error('net::ERR_TIMED_OUT');
            },
        });

        assert.equal(await lookup.addressesFor(YATTA), null);
    });

    it('caches a failure so a broken company page is not reloaded once per job', async ({
        assert,
    }) => {
        const pending = makeLookup({
            locationsFor: () => locationsOf('Frankfurt'),
            onGoto: () => {
                throw new Error('net::ERR_TIMED_OUT');
            },
            emptyRetries: 0,
        });
        const lookup = await pending;

        await lookup.addressesFor(YATTA);
        await lookup.addressesFor(YATTA);

        assert.equal(pending.recorder.gotos.length, 1);
    });

    it('returns null without navigating when the card carried no company URL', async ({
        assert,
    }) => {
        const pending = makeLookup({
            locationsFor: () => locationsOf('Frankfurt'),
        });
        const lookup = await pending;

        assert.equal(await lookup.addressesFor(null), null);
        assert.deepEqual(pending.recorder.gotos, []);
    });

    it('maxAddressesPerCompany caps the list while keeping the primary address', async ({
        assert,
    }) => {
        const lookup = await makeLookup({
            // Primary is third in DOM order, so a naive cap would drop it.
            locationsFor: () => [
                { isPrimary: false, lines: ['Berlin, DE'] },
                { isPrimary: false, lines: ['Hamburg, DE'] },
                { isPrimary: true, lines: ['Dortmund, DE'] },
            ],
            maxAddressesPerCompany: 2,
        });

        const addresses = await lookup.addressesFor(ADESSO);

        assert.deepEqual(
            addresses?.map((a) => a.city),
            ['Dortmund', 'Berlin'],
        );
    });
});
