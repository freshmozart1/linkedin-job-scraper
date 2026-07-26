import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalityLine, parseCompanyLocation, toCompanyAddresses } from '../src/index';
import type { CompanyAddress, RawCompanyLocation } from '../src/index';

// Every locality line below was copied verbatim off a live LinkedIn company
// page — these are the real shapes the parser has to survive, not invented
// ones. Each row covers a distinct combination of present/absent parts.
const LOCALITY_LINES: [line: string, expected: Pick<CompanyAddress, 'city' | 'postalCode' | 'countryCode'>][] = [
  // city, region + postal, country — the common case
  ['Frankfurt, Hesse 60322, DE', { city: 'Frankfurt', postalCode: 'Hesse 60322', countryCode: 'DE' }],
  ['Frankfurt am Main, Hessen 60313, DE', { city: 'Frankfurt am Main', postalCode: 'Hessen 60313', countryCode: 'DE' }],
  // US state abbreviation and full state name both land in postalCode
  ['Pittsburgh, PA 15219, US', { city: 'Pittsburgh', postalCode: 'PA 15219', countryCode: 'US' }],
  ['Tempe, Arizona 85281, US', { city: 'Tempe', postalCode: 'Arizona 85281', countryCode: 'US' }],
  // no region
  ['Hamburg, 20457, DE', { city: 'Hamburg', postalCode: '20457', countryCode: 'DE' }],
  // no postal code
  ['Berlin, BE, DE', { city: 'Berlin', postalCode: 'BE', countryCode: 'DE' }],
  ['Köln, Nordrhein-Westfalen, DE', { city: 'Köln', postalCode: 'Nordrhein-Westfalen', countryCode: 'DE' }],
  // neither
  ['Wien, AT', { city: 'Wien', postalCode: null, countryCode: 'AT' }],
  ['Global, GB', { city: 'Global', postalCode: null, countryCode: 'GB' }],
  // postal codes containing spaces must not be split
  ['Utrecht, 3521 BC, NL', { city: 'Utrecht', postalCode: '3521 BC', countryCode: 'NL' }],
  ['Malmö, Skåne County 211 34, SE', { city: 'Malmö', postalCode: 'Skåne County 211 34', countryCode: 'SE' }],
  ['London, England W2 6BD, GB', { city: 'London', postalCode: 'England W2 6BD', countryCode: 'GB' }],
  // stray whitespace around a segment (LinkedIn emits this)
  ['Rostock, Mecklenburg-Vorpommern 18057 , DE', { city: 'Rostock', postalCode: 'Mecklenburg-Vorpommern 18057', countryCode: 'DE' }],
  // a numeric placeholder region, not a postal code — kept as-is either way
  ['Worldwide, 00, CA', { city: 'Worldwide', postalCode: '00', countryCode: 'CA' }],
];

for (const [line, expected] of LOCALITY_LINES) {
  test(`parseLocalityLine splits "${line}"`, () => {
    assert.deepEqual(parseLocalityLine(line), expected);
  });
}

test('parseLocalityLine keeps a two-letter-only line as the city rather than reading it as a country', () => {
  // Guarded on segment count: popping here would leave city null and lose the
  // only piece of information the line carried.
  assert.deepEqual(parseLocalityLine('AT'), { city: 'AT', postalCode: null, countryCode: null });
});

test('parseLocalityLine uppercases a lowercased country code', () => {
  assert.equal(parseLocalityLine('Frankfurt, Hessen 60313, de').countryCode, 'DE');
});

test('parseLocalityLine pushes a comma-containing city into postalCode (documented limitation)', () => {
  // Nothing in the markup says where the city ends, so the overflow has to go
  // somewhere. Pinned here so a future change to this behavior is deliberate.
  assert.deepEqual(parseLocalityLine('Nalanchira, Thiruvananthapuram, Kerala, 695015 , IN'), {
    city: 'Nalanchira',
    postalCode: 'Thiruvananthapuram, Kerala, 695015',
    countryCode: 'IN',
  });
});

test('parseCompanyLocation reads a single line as the locality line, not as a street', () => {
  // An address with no street block renders as one <p> holding the locality
  // line — reading the *first* line as the street would corrupt every one.
  assert.deepEqual(parseCompanyLocation({ isPrimary: true, lines: ['Mannheim, Baden-Württemberg 68526, DE'] }), {
    streetAddress: null,
    city: 'Mannheim',
    postalCode: 'Baden-Württemberg 68526',
    countryCode: 'DE',
  });
});

test('parseCompanyLocation reads the first of two lines as the street', () => {
  assert.deepEqual(
    parseCompanyLocation({ isPrimary: true, lines: ['Bockenheimer Anlage 46', 'Frankfurt, Hesse 60322, DE'] }),
    { streetAddress: 'Bockenheimer Anlage 46', city: 'Frankfurt', postalCode: 'Hesse 60322', countryCode: 'DE' }
  );
});

test('parseCompanyLocation joins two street lines with a comma', () => {
  assert.equal(
    parseCompanyLocation({ isPrimary: true, lines: ['2 Kingdom Street', 'First Floor', 'London, England W2 6BD, GB'] })
      ?.streetAddress,
    '2 Kingdom Street, First Floor'
  );
});

test('parseCompanyLocation returns null for a location with no lines at all', () => {
  assert.equal(parseCompanyLocation({ isPrimary: false, lines: [] }), null);
});

function location(isPrimary: boolean, city: string): RawCompanyLocation {
  return { isPrimary, lines: [`${city} Street 1`, `${city}, DE`] };
}

test('toCompanyAddresses keeps DOM order when the primary is already first', () => {
  const addresses = toCompanyAddresses([location(true, 'Dortmund'), location(false, 'Berlin')]);
  assert.deepEqual(addresses.map((a) => a.city), ['Dortmund', 'Berlin']);
});

test('toCompanyAddresses moves a later primary to index 0, keeping the rest in order', () => {
  const addresses = toCompanyAddresses([
    location(false, 'Berlin'),
    location(false, 'Hamburg'),
    location(true, 'Dortmund'),
    location(false, 'Köln'),
  ]);
  assert.deepEqual(addresses.map((a) => a.city), ['Dortmund', 'Berlin', 'Hamburg', 'Köln']);
});

test('toCompanyAddresses falls back to DOM order when no location is tagged primary', () => {
  const addresses = toCompanyAddresses([location(false, 'Berlin'), location(false, 'Hamburg')]);
  assert.deepEqual(addresses.map((a) => a.city), ['Berlin', 'Hamburg']);
});

test('toCompanyAddresses drops unparseable locations without shifting the primary', () => {
  // The primary index is tracked against the parsed array, so an empty
  // location ahead of it must not push it out of position.
  const addresses = toCompanyAddresses([
    { isPrimary: false, lines: [] },
    location(false, 'Berlin'),
    location(true, 'Dortmund'),
  ]);
  assert.deepEqual(addresses.map((a) => a.city), ['Dortmund', 'Berlin']);
});

test('toCompanyAddresses returns an empty array for a company page with no locations', () => {
  assert.deepEqual(toCompanyAddresses([]), []);
});
