import { describe, it } from 'node:test';
import { toCompanyAddresses } from '../src/index';
import type { RawCompanyLocation } from '../src/index';

function location(isPrimary: boolean, city: string): RawCompanyLocation {
    return { isPrimary, lines: [`${city} Street 1`, `${city}, DE`] };
}

describe('toCompanyAddresses()', () => {
    it('keeps DOM order when the primary is already first', ({ assert }) => {
        const addresses = toCompanyAddresses([
            location(true, 'Dortmund'),
            location(false, 'Berlin'),
        ]);
        assert.deepEqual(
            addresses.map((a) => a.city),
            ['Dortmund', 'Berlin'],
        );
    });

    it('moves a later primary to index 0, keeping the rest in order', ({
        assert,
    }) => {
        const addresses = toCompanyAddresses([
            location(false, 'Berlin'),
            location(false, 'Hamburg'),
            location(true, 'Dortmund'),
            location(false, 'Köln'),
        ]);
        assert.deepEqual(
            addresses.map((a) => a.city),
            ['Dortmund', 'Berlin', 'Hamburg', 'Köln'],
        );
    });

    it('falls back to DOM order when no location is tagged primary', ({
        assert,
    }) => {
        const addresses = toCompanyAddresses([
            location(false, 'Berlin'),
            location(false, 'Hamburg'),
        ]);
        assert.deepEqual(
            addresses.map((a) => a.city),
            ['Berlin', 'Hamburg'],
        );
    });

    it('drops unparseable locations without shifting the primary', ({
        assert,
    }) => {
        // The primary index is tracked against the parsed array, so an empty
        // location ahead of it must not push it out of position.
        const addresses = toCompanyAddresses([
            { isPrimary: false, lines: [] },
            location(false, 'Berlin'),
            location(true, 'Dortmund'),
        ]);
        assert.deepEqual(
            addresses.map((a) => a.city),
            ['Dortmund', 'Berlin'],
        );
    });

    it('returns an empty array for a company page with no locations', ({
        assert,
    }) => {
        assert.deepEqual(toCompanyAddresses([]), []);
    });
});
