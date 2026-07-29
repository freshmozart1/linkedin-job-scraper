import { describe, it } from 'node:test';
import { parseLocalityLine } from '../src/index';
import type { CompanyAddress } from '../src/index';

// Every locality line below was copied verbatim off a live LinkedIn company
// page — these are the real shapes the parser has to survive, not invented
// ones. Each row covers a distinct combination of present/absent parts.
const LOCALITY_LINES: [
    line: string,
    expected: Pick<CompanyAddress, 'city' | 'postalCode' | 'countryCode'>,
][] = [
    // city, region + postal, country — the common case
    [
        'Frankfurt, Hesse 60322, DE',
        { city: 'Frankfurt', postalCode: 'Hesse 60322', countryCode: 'DE' },
    ],
    [
        'Frankfurt am Main, Hessen 60313, DE',
        {
            city: 'Frankfurt am Main',
            postalCode: 'Hessen 60313',
            countryCode: 'DE',
        },
    ],
    // US state abbreviation and full state name both land in postalCode
    [
        'Pittsburgh, PA 15219, US',
        { city: 'Pittsburgh', postalCode: 'PA 15219', countryCode: 'US' },
    ],
    [
        'Tempe, Arizona 85281, US',
        { city: 'Tempe', postalCode: 'Arizona 85281', countryCode: 'US' },
    ],
    // no region
    [
        'Hamburg, 20457, DE',
        { city: 'Hamburg', postalCode: '20457', countryCode: 'DE' },
    ],
    // no postal code
    ['Berlin, BE, DE', { city: 'Berlin', postalCode: 'BE', countryCode: 'DE' }],
    [
        'Köln, Nordrhein-Westfalen, DE',
        {
            city: 'Köln',
            postalCode: 'Nordrhein-Westfalen',
            countryCode: 'DE',
        },
    ],
    // neither
    ['Wien, AT', { city: 'Wien', postalCode: null, countryCode: 'AT' }],
    ['Global, GB', { city: 'Global', postalCode: null, countryCode: 'GB' }],
    // postal codes containing spaces must not be split
    [
        'Utrecht, 3521 BC, NL',
        { city: 'Utrecht', postalCode: '3521 BC', countryCode: 'NL' },
    ],
    [
        'Malmö, Skåne County 211 34, SE',
        {
            city: 'Malmö',
            postalCode: 'Skåne County 211 34',
            countryCode: 'SE',
        },
    ],
    [
        'London, England W2 6BD, GB',
        {
            city: 'London',
            postalCode: 'England W2 6BD',
            countryCode: 'GB',
        },
    ],
    // stray whitespace around a segment (LinkedIn emits this)
    [
        'Rostock, Mecklenburg-Vorpommern 18057 , DE',
        {
            city: 'Rostock',
            postalCode: 'Mecklenburg-Vorpommern 18057',
            countryCode: 'DE',
        },
    ],
    // a numeric placeholder region, not a postal code — kept as-is either way
    [
        'Worldwide, 00, CA',
        { city: 'Worldwide', postalCode: '00', countryCode: 'CA' },
    ],
];

describe('parseLocalityLine()', () => {
    for (const [line, expected] of LOCALITY_LINES) {
        it(`splits "${line}"`, ({ assert }) => {
            assert.deepEqual(parseLocalityLine(line), expected);
        });
    }

    it('keeps a two-letter-only line as the city rather than reading it as a country', ({
        assert,
    }) => {
        // Guarded on segment count: popping here would leave city null and lose
        // the only piece of information the line carried.
        assert.deepEqual(parseLocalityLine('AT'), {
            city: 'AT',
            postalCode: null,
            countryCode: null,
        });
    });

    it('uppercases a lowercased country code', ({ assert }) => {
        assert.equal(
            parseLocalityLine('Frankfurt, Hessen 60313, de').countryCode,
            'DE',
        );
    });

    it('pushes a comma-containing city into postalCode (documented limitation)', ({
        assert,
    }) => {
        // Nothing in the markup says where the city ends, so the overflow has
        // to go somewhere. Pinned here so a future change to this behavior is
        // deliberate.
        assert.deepEqual(
            parseLocalityLine(
                'Nalanchira, Thiruvananthapuram, Kerala, 695015 , IN',
            ),
            {
                city: 'Nalanchira',
                postalCode: 'Thiruvananthapuram, Kerala, 695015',
                countryCode: 'IN',
            },
        );
    });
});
