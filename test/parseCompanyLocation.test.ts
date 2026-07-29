import { describe, it } from 'node:test';
import { parseCompanyLocation } from '../src/index';

describe('parseCompanyLocation()', () => {
    it('reads a single line as the locality line, not as a street', ({
        assert,
    }) => {
        // An address with no street block renders as one <p> holding the
        // locality line — reading the *first* line as the street would
        // corrupt every one.
        assert.deepEqual(
            parseCompanyLocation({
                isPrimary: true,
                lines: ['Mannheim, Baden-Württemberg 68526, DE'],
            }),
            {
                streetAddress: null,
                city: 'Mannheim',
                postalCode: 'Baden-Württemberg 68526',
                countryCode: 'DE',
            },
        );
    });

    it('reads the first of two lines as the street', ({ assert }) => {
        assert.deepEqual(
            parseCompanyLocation({
                isPrimary: true,
                lines: ['Bockenheimer Anlage 46', 'Frankfurt, Hesse 60322, DE'],
            }),
            {
                streetAddress: 'Bockenheimer Anlage 46',
                city: 'Frankfurt',
                postalCode: 'Hesse 60322',
                countryCode: 'DE',
            },
        );
    });

    it('joins two street lines with a comma', ({ assert }) => {
        assert.equal(
            parseCompanyLocation({
                isPrimary: true,
                lines: [
                    '2 Kingdom Street',
                    'First Floor',
                    'London, England W2 6BD, GB',
                ],
            })?.streetAddress,
            '2 Kingdom Street, First Floor',
        );
    });

    it('returns null for a location with no lines at all', ({ assert }) => {
        assert.equal(
            parseCompanyLocation({ isPrimary: false, lines: [] }),
            null,
        );
    });
});
