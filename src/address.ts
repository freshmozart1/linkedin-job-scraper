// Pure parsing of the "Locations" section LinkedIn renders on a company page.
// No Playwright, no DOM — companyLookup.ts reads the raw text off the page and
// hands it here, which keeps every parsing rule below testable offline.
//
// LinkedIn prints each address as up to two optional street lines followed by
// one locality line, each in its own `<p>`:
//
//     2 Kingdom Street          <- street line 1 (optional)
//     First Floor               <- street line 2 (optional)
//     London, England W2 6BD, GB <- locality line (always present, always last)
//
// Everything here follows from that shape.

import type { CompanyAddress, RawCompanyLocation } from './types';

/**
 * Splits LinkedIn's locality line into city / region+postal / country.
 *
 * The line is comma-separated but its *middle* is not: LinkedIn joins the
 * region and the postal code with a plain space and no separator that
 * distinguishes them (`Hessen 60313`, `WA 98104`, `England W2 6BD`), and
 * either half can be missing (`Hamburg, 20457, DE` has no region, `Berlin,
 * BE, DE` has no postal code). Splitting that apart would take a country-by-
 * country table of region names and postal formats, so it deliberately stays
 * joined in `postalCode`.
 *
 * The country code is taken from the end rather than the front because the
 * city is the only reliably-first segment; measured across 461 real addresses
 * the trailing 2-letter code was present every single time.
 *
 * Known limitation: a city containing commas (`Nalanchira, Thiruvananthapuram,
 * Kerala, 695015 , IN`) pushes its own overflow into `postalCode`, since
 * nothing in the markup says where the city ends. 1 occurrence in 461.
 */
export function parseLocalityLine(line: string): Pick<CompanyAddress, 'city' | 'postalCode' | 'countryCode'> {
  const segments = line
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  // Guarded on length so a lone `AT` is read as the city it's sitting in
  // rather than being popped off and leaving no city behind at all.
  const lastSegment = segments[segments.length - 1];
  let countryCode: string | null = null;
  if (segments.length > 1 && lastSegment !== undefined && /^[A-Za-z]{2}$/.test(lastSegment)) {
    countryCode = lastSegment.toUpperCase();
    segments.pop();
  }
  const city = segments.shift() ?? null;

  return { city, postalCode: segments.length > 0 ? segments.join(', ') : null, countryCode };
}

/**
 * Parses one location `<li>`'s text lines into an address.
 *
 * The last line is always the locality line and everything before it is
 * street. That rule — rather than "the first line is the street" — is what
 * makes the street-less case work: an address with no street block renders as
 * a single `<p>` holding the locality line, not an empty street line.
 */
export function parseCompanyLocation(raw: RawCompanyLocation): CompanyAddress | null {
  const localityLine = raw.lines[raw.lines.length - 1];
  if (localityLine === undefined) return null;

  const streetLines = raw.lines.slice(0, -1);
  return {
    streetAddress: streetLines.length > 0 ? streetLines.join(', ') : null,
    ...parseLocalityLine(localityLine),
  };
}

/**
 * Parses every location on a company page and puts the primary address at
 * index 0.
 *
 * LinkedIn happens to render the primary location first today, but the
 * `isPrimary` tag is the actual contract and the ordering isn't — so this
 * reorders off the flag and only falls back to DOM order when nothing is
 * flagged at all.
 */
export function toCompanyAddresses(raws: RawCompanyLocation[]): CompanyAddress[] {
  const parsed: CompanyAddress[] = [];
  let primaryIndex = -1;

  for (const raw of raws) {
    const address = parseCompanyLocation(raw);
    if (!address) continue;
    // Tracked against the *parsed* array, not the raw one, so an unparseable
    // location earlier in the list can't shift the primary's index.
    if (raw.isPrimary && primaryIndex === -1) primaryIndex = parsed.length;
    parsed.push(address);
  }

  if (primaryIndex > 0) {
    const [primary] = parsed.splice(primaryIndex, 1);
    if (primary) parsed.unshift(primary);
  }
  return parsed;
}
