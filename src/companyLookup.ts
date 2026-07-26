// Reads a company's office addresses off its public LinkedIn page.
//
// This runs on its own browser context, separate from the one driving the job
// search, for a reason that is not an optimization: LinkedIn only serves the
// "Locations" section to a cookie jar that hasn't seen a company page yet.
// Load two company pages in a row on the same context and the second one comes
// back *without* the section — no error, no sign-in wall, the markup is simply
// absent, which is indistinguishable from a company that publishes no address.
// Clearing cookies before each navigation restores it (measured: 54/54 company
// pages returned their section that way, versus 1/54 without).
//
// Since clearing cookies on the search context would throw away the guest job
// session mid-run, the lookup gets a context of its own.
//
// Related: LinkedIn answers `fetch()` for these pages with HTTP 999, so the
// page has to be genuinely navigated to — there is no cheap request-only path.

import type { Browser, BrowserContext, Page } from 'playwright';
import { toCompanyAddresses } from './address';
import type { CompanyAddress, RawCompanyLocation } from './types';

export interface CompanyLookupOptions {
  navigationTimeoutMs?: number;
  /**
   * Extra attempts whenever an attempt yields no addresses — named for the
   * case it exists for (a page that loads with its Locations section absent,
   * which LinkedIn serves intermittently: the same company can come back with
   * addresses on one load and empty on the next), but the same budget also
   * covers an `/authwall` bounce and a navigation that throws. So
   * `emptyRetries: 0` disables retrying those too, not just empty pages.
   */
  emptyRetries?: number;
  /** Pause after a lookup that hit the network. Cache hits skip it entirely. */
  delayBetweenLookupsMs?: number;
  /**
   * Optional cap on how many addresses to keep per company. The list is
   * primary-first, so any cap of 1 or more keeps the primary address.
   */
  maxAddressesPerCompany?: number;
}

export interface CompanyLookup {
  /**
   * Addresses for one company, with the primary at index 0. Resolves to `[]`
   * when the page was read and publishes none, and to `null` when nothing
   * could be read at all (no URL, blocked page, navigation error). Never
   * rejects — a company page failing must not fail the job that referenced it.
   */
  addressesFor(companyUrl: string | null): Promise<CompanyAddress[] | null>;
  close(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// LinkedIn bounces guests to `/authwall` intermittently. It's a redirect, not
// an error, so the only way to notice is to look at where we actually landed.
function isAuthWall(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/authwall');
  } catch {
    return false;
  }
}

async function readRawLocations(page: Page): Promise<RawCompanyLocation[]> {
  return page.evaluate(() => {
    // Runs in the browser context; this package compiles without the DOM lib,
    // so only the specific members used here are typed structurally.
    interface MinimalElement {
      querySelector(selector: string): MinimalElement | null;
      querySelectorAll(selector: string): ArrayLike<MinimalElement>;
      textContent: string | null;
    }
    const g = globalThis as unknown as {
      document: { querySelectorAll(selector: string): ArrayLike<MinimalElement> };
    };

    // Also hardcoded literally here (page.evaluate serializes the callback via
    // toString(), so it can't close over selectors.ts's exports) — keep in
    // sync with COMPANY_LOCATION_ITEM_SELECTOR / COMPANY_PRIMARY_TAG_SELECTOR
    // in ./selectors if these ever change.
    const items = Array.from(g.document.querySelectorAll('section.locations li'));

    return items.map((item) => ({
      isPrimary: item.querySelector('.tag-sm') !== null,
      // textContent, not innerText: past the first four, locations are
      // collapsed behind a "Show more locations" button that hides them with
      // CSS only. They're all in the DOM already, so nothing has to be
      // clicked — but innerText would come back empty for the hidden ones.
      lines: Array.from(item.querySelectorAll('p'))
        .map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    }));
  });
}

/**
 * Creates the company-address lookup: a dedicated browser context, one page in
 * it, and a per-run cache keyed by company URL.
 *
 * The cache is what makes this affordable. A 60-job search typically covers
 * only ~54 distinct companies, duplicate cards resolve to the same company,
 * and the stale-retry pass re-scrapes jobs that were already looked up — so
 * without it the same page would be fetched several times over.
 */
export async function createCompanyLookup(
  browser: Browser,
  options: CompanyLookupOptions = {}
): Promise<CompanyLookup> {
  const {
    navigationTimeoutMs = 20000,
    emptyRetries = 1,
    delayBetweenLookupsMs = 900,
    maxAddressesPerCompany,
  } = options;

  const context: BrowserContext = await browser.newContext();
  const page: Page = await context.newPage();
  // Failed lookups are cached as null too, so a permanently broken company
  // page costs one navigation per run rather than one per job referencing it.
  const cache = new Map<string, CompanyAddress[] | null>();

  async function fetchAddresses(companyUrl: string): Promise<CompanyAddress[] | null> {
    // Only a successful read writes here, so a failing retry can never downgrade
    // an earlier `[]` (page read, company publishes nothing) into null (nothing
    // could be read at all). Those two are different answers downstream, and the
    // loser of that race gets cached for the rest of the run.
    let bestResult: CompanyAddress[] | null = null;

    for (let attempt = 0; attempt <= emptyRetries; attempt++) {
      try {
        // Before every navigation, not just the first: this is the whole
        // reason the section keeps being served. See the file header.
        await context.clearCookies();
        await page.goto(companyUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });

        if (isAuthWall(page.url())) continue;

        const addresses = toCompanyAddresses(await readRawLocations(page));
        // An empty result is either a company with no published address or a
        // page served without its section — indistinguishable, so retry it.
        if (addresses.length > 0) return addresses;
        bestResult = addresses;
      } catch {
        // Left alone deliberately: a navigation that blew up says nothing
        // about what the company publishes, so it must not overwrite a read
        // that already succeeded.
      }
    }

    return bestResult;
  }

  return {
    async addressesFor(companyUrl: string | null): Promise<CompanyAddress[] | null> {
      if (!companyUrl) return null;

      const cached = cache.get(companyUrl);
      if (cached !== undefined) return cached;

      const addresses = await fetchAddresses(companyUrl);
      const capped =
        addresses && maxAddressesPerCompany !== undefined
          ? addresses.slice(0, maxAddressesPerCompany)
          : addresses;

      cache.set(companyUrl, capped);
      if (delayBetweenLookupsMs > 0) await sleep(delayBetweenLookupsMs);
      return capped;
    },

    async close(): Promise<void> {
      await context.close();
    },
  };
}
