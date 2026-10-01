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
// JobBudget comes from ./types (all public types live there), imported
// type-only so this file keeps zero coupling to scraper/ — the budget is
// created there, but nothing about reading a company page depends on it.
import type { CompanyAddress, JobBudget, RawCompanyLocation } from './types';

export interface CompanyLookupOptions {
  navigationTimeoutMs?: number;
  /**
   * Extra attempts whenever an attempt yields no addresses — named for the
   * case it exists for (a page that loads with its Locations section absent,
   * which LinkedIn serves intermittently: the same company can come back with
   * addresses on one load and empty on the next), but the same budget also
   * covers an `/authwall` bounce, an unsuccessful or missing HTTP response,
   * and a navigation that throws. So
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
   * could be read at all (no URL, blocked page, unsuccessful or missing HTTP
   * response, navigation error). Never
   * rejects — a company page failing must not fail the job that referenced it.
   *
   * `budget` is the calling job's wall-clock budget, when it has one. It only
   * ever shortens this lookup: the navigation timeout is clamped to what the
   * job has left, the `emptyRetries` loop stops once there is nothing left to
   * spend, and `delayBetweenLookupsMs` is skipped then too. Worth threading
   * because this is the single most expensive step in a job — up to
   * `navigationTimeoutMs × (1 + emptyRetries)` plus the delay. A budget that
   * has already collapsed simply yields `null`, exactly like any other
   * lookup that could not read the page.
   */
  addressesFor(
    companyUrl: string | null,
    budget?: JobBudget
  ): Promise<CompanyAddress[] | null>;
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

  async function fetchAddresses(
    companyUrl: string,
    budget?: JobBudget
  ): Promise<CompanyAddress[] | null | undefined> {
    // Only a successful read writes here, so a failing retry can never downgrade
    // an earlier `[]` (page read, company publishes nothing) into null (nothing
    // could be read at all). Those two are different answers downstream, and the
    // loser of that race gets cached for the rest of the run.
    //
    // `undefined` is a third answer, distinct from both, and it exists only for
    // the budget: it means no attempt was made at all, so nothing was learned
    // about this company and the caller must not cache anything.
    let bestResult: CompanyAddress[] | null | undefined = undefined;

    for (let attempt = 0; attempt <= emptyRetries; attempt++) {
      // A spent budget (or an abort, which reads as no time left) stops the
      // loop rather than paying for navigations that can only time out. On
      // the very first attempt that leaves `bestResult` at `undefined` —
      // "never looked", not "looked and failed" — which is why this can still
      // promise never to reject.
      if (budget?.remaining() === 0) break;
      // Past here an attempt is being made, so `null` (a real failure) is the
      // worst this can now report.
      if (bestResult === undefined) bestResult = null;
      try {
        // Before every navigation, not just the first: this is the whole
        // reason the section keeps being served. See the file header.
        await context.clearCookies();
        const response = await page.goto(companyUrl, {
          waitUntil: 'domcontentloaded',
          timeout: budget?.boundedTimeout(navigationTimeoutMs) ?? navigationTimeoutMs
        });

        // HTTP error documents can omit Locations just like a valid empty
        // page. Only a successful response can establish an empty result.
        if (!response?.ok()) continue;
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
    async addressesFor(
      companyUrl: string | null,
      budget?: JobBudget
    ): Promise<CompanyAddress[] | null> {
      if (!companyUrl) return null;

      const cached = cache.get(companyUrl);
      if (cached !== undefined) return cached;

      const addresses = await fetchAddresses(companyUrl, budget);
      // Nothing may be cached when the budget, not the company page, produced
      // this answer — `undefined` means no navigation was even attempted, and a
      // `null` handed back by a job whose budget has since run out came from a
      // `goto` clamped to whatever milliseconds were left rather than to
      // `navigationTimeoutMs`. Neither says anything about the company, and the
      // cache is run-wide: caching one would deny every later job at this
      // company a real attempt and silently report them all as address-less.
      // A failure on a healthy budget is still cached, which is the case the
      // cache comment above is about.
      if (
        addresses === undefined ||
        (addresses === null && budget?.remaining() === 0)
      )
        return null;
      const capped =
        addresses && maxAddressesPerCompany !== undefined
          ? addresses.slice(0, maxAddressesPerCompany)
          : addresses;

      cache.set(companyUrl, capped);
      // The politeness delay exists to space out real network hits, so it is
      // clamped to what the job has left rather than paid in full: at
      // `remaining() === 0` there are no more hits coming for this job at all,
      // and just short of that a full 900ms sleep would overrun the very
      // deadline the budget exists to hold.
      const delay = Math.min(
        delayBetweenLookupsMs,
        budget?.remaining() ?? Infinity
      );
      if (delay > 0) await sleep(delay);
      return capped;
    },

    async close(): Promise<void> {
      await context.close();
    },
  };
}
