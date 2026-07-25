import test from 'node:test';
import assert from 'node:assert/strict';
import type { Locator } from 'playwright';
import {
  isCompanyMismatch,
  isStaleResult,
  registerJobOccurrence,
  buildSearchUrl,
  normalizeJobUrl,
  hostnameOf,
  jobIdFromUrl,
  clearBlockingOverlays,
  scrollLoadPhase,
  clickLoadPhase,
  scrapeAllJobsOnce,
  scrapeJob,
  OVERLAY_SELECTOR,
  VIEWED_ALL_JOBS_SELECTOR,
  JOB_LIST_SELECTOR,
  LIST_COMPANY_SELECTOR,
  COMPANY_SELECTOR,
  DESCRIPTION_SELECTOR,
  JOB_LINK_SELECTOR,
  type JobResult,
  type ScrapeProgressEvent,
} from '../src/index';
import { createFakeLocator, createFakePage } from './helpers/fakePlaywright';

test('buildSearchUrl embeds the keywords in the keywords query param', () => {
  const url = new URL(buildSearchUrl({ keywords: 'Frontend Developer' }));
  assert.equal(url.searchParams.get('keywords'), 'Frontend Developer');
});

test('buildSearchUrl sends no location/geoId when none is supplied — nothing is fixed', () => {
  const url = new URL(buildSearchUrl({ keywords: 'Backend Developer' }));
  assert.equal(url.searchParams.has('location'), false);
  assert.equal(url.searchParams.has('geoId'), false);
});

test('buildSearchUrl sends location/geoId only when the caller explicitly supplies them', () => {
  const url = new URL(buildSearchUrl({ keywords: 'Backend Developer', location: 'Berlin, Germany', geoId: '123' }));
  assert.equal(url.searchParams.get('location'), 'Berlin, Germany');
  assert.equal(url.searchParams.get('geoId'), '123');
});

test('buildSearchUrl encodes special characters in the keyword', () => {
  const url = new URL(buildSearchUrl({ keywords: 'C++ / C# Developer' }));
  assert.equal(url.searchParams.get('keywords'), 'C++ / C# Developer');
});

test('buildSearchUrl targets the LinkedIn guest job search path', () => {
  const url = new URL(buildSearchUrl({ keywords: 'Frontend Developer' }));
  assert.equal(url.origin + url.pathname, 'https://www.linkedin.com/jobs/search');
});

test('buildSearchUrl translates datePosted/experienceLevels/jobTypes/workplaceTypes/sortBy to LinkedIn query codes', () => {
  const url = new URL(
    buildSearchUrl({
      keywords: 'Engineer',
      datePosted: 'week',
      experienceLevels: ['entry', 'mid-senior'],
      jobTypes: ['full-time', 'contract'],
      workplaceTypes: ['remote'],
      distanceMiles: 25,
      sortBy: 'date',
    })
  );
  assert.equal(url.searchParams.get('f_TPR'), 'r604800');
  assert.equal(url.searchParams.get('f_E'), '2,4');
  assert.equal(url.searchParams.get('f_JT'), 'F,C');
  assert.equal(url.searchParams.get('f_WT'), '2');
  assert.equal(url.searchParams.get('distance'), '25');
  assert.equal(url.searchParams.get('sortBy'), 'DD');
});

test('buildSearchUrl applies extraParams verbatim as an escape hatch', () => {
  const url = new URL(buildSearchUrl({ keywords: 'Engineer', extraParams: { trk: 'custom-trk', pageNum: '2' } }));
  assert.equal(url.searchParams.get('trk'), 'custom-trk');
  assert.equal(url.searchParams.get('pageNum'), '2');
});

const SEARCH_PAGE_URL = 'https://de.linkedin.com/jobs/search?keywords=frontend';

test('normalizeJobUrl returns null for a missing href', () => {
  assert.equal(normalizeJobUrl(null, SEARCH_PAGE_URL), null);
});

test('normalizeJobUrl resolves a relative href against the search page URL', () => {
  assert.equal(
    normalizeJobUrl('/jobs/view/frontend-developer-at-acme-111', SEARCH_PAGE_URL),
    'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111'
  );
});

test('normalizeJobUrl keeps an absolute href on its own country subdomain', () => {
  assert.equal(
    normalizeJobUrl('https://uk.linkedin.com/jobs/view/x-111', SEARCH_PAGE_URL),
    'https://uk.linkedin.com/jobs/view/x-111'
  );
});

test('normalizeJobUrl strips the tracking query string and fragment', () => {
  assert.equal(
    normalizeJobUrl('https://de.linkedin.com/jobs/view/x-111?refId=a&trackingId=b&position=3#top', SEARCH_PAGE_URL),
    'https://de.linkedin.com/jobs/view/x-111'
  );
});

test('normalizeJobUrl returns null for a scheme that carries no hostname', () => {
  assert.equal(normalizeJobUrl('javascript:void(0)', SEARCH_PAGE_URL), null);
  assert.equal(normalizeJobUrl('mailto:jobs@acme.com', SEARCH_PAGE_URL), null);
});

test('hostnameOf reads the country-specific subdomain LinkedIn assigns the posting', () => {
  assert.equal(hostnameOf('https://de.linkedin.com/jobs/view/x-111'), 'de.linkedin.com');
});

test('hostnameOf returns null rather than an empty string when there is no hostname', () => {
  assert.equal(hostnameOf(null), null);
  assert.equal(hostnameOf('not a url'), null);
  assert.equal(hostnameOf('javascript:void(0)'), null);
});

test('jobIdFromUrl recovers the posting ID from a normalized job URL', () => {
  assert.equal(jobIdFromUrl('https://de.linkedin.com/jobs/view/frontend-developer-at-acme-4012345678'), '4012345678');
});

test('jobIdFromUrl returns null when the URL has no trailing posting ID', () => {
  assert.equal(jobIdFromUrl(null), null);
  assert.equal(jobIdFromUrl('https://de.linkedin.com/jobs/search'), null);
});

test('isCompanyMismatch is false when the list company could not be read', () => {
  assert.equal(isCompanyMismatch({ listCompany: null, detailCompany: 'Acme Corp' }), false);
});

test('isCompanyMismatch is false when the detail company could not be read', () => {
  assert.equal(isCompanyMismatch({ listCompany: 'Acme Corp', detailCompany: null }), false);
});

test('isCompanyMismatch is false when both sides match verbatim', () => {
  assert.equal(isCompanyMismatch({ listCompany: 'Acme Corp', detailCompany: 'Acme Corp' }), false);
});

test('isCompanyMismatch ignores surrounding whitespace differences when comparing', () => {
  assert.equal(isCompanyMismatch({ listCompany: 'Acme Corp', detailCompany: '  Acme Corp  ' }), false);
});

test('isCompanyMismatch is true when the companies genuinely differ', () => {
  assert.equal(isCompanyMismatch({ listCompany: 'Acme Corp', detailCompany: 'Zellerfeld Shoe Company Inc.' }), true);
});

function makeResult(partial: Partial<JobResult> & { index: number }): JobResult {
  return {
    title: null,
    company: null,
    descriptionText: null,
    status: 'success',
    error: null,
    companyMismatch: false,
    lateOverlayDetected: false,
    sourceJobId: null,
    sourceUrl: null,
    sourceHostname: null,
    scrapedAt: '2024-01-01T00:00:00.000Z',
    duplicateOfIdx: null,
    ...partial,
  };
}

test('isStaleResult is false for a successful, clean result', () => {
  assert.equal(isStaleResult(makeResult({ index: 0 })), false);
});

test('isStaleResult is true for a successful result with a company mismatch', () => {
  assert.equal(isStaleResult(makeResult({ index: 0, companyMismatch: true })), true);
});

test('isStaleResult is true for a successful result with a late overlay detected', () => {
  assert.equal(isStaleResult(makeResult({ index: 0, lateOverlayDetected: true })), true);
});

test('isStaleResult is false for a failed result even if the stale flags are set', () => {
  assert.equal(
    isStaleResult(makeResult({ index: 0, status: 'failed', companyMismatch: true, lateOverlayDetected: true })),
    false
  );
});

test('registerJobOccurrence registers a first occurrence and reports no duplicate', () => {
  const seen = new Map<string, number>();
  assert.equal(registerJobOccurrence(seen, '12345', 0), null);
  assert.equal(seen.get('12345'), 0);
});

test('registerJobOccurrence reports a later occurrence as duplicate of the first index', () => {
  const seen = new Map<string, number>();
  registerJobOccurrence(seen, '12345', 2);
  assert.equal(registerJobOccurrence(seen, '12345', 5), 2);
});

test('registerJobOccurrence keeps the map pointing at the first occurrence', () => {
  const seen = new Map<string, number>();
  registerJobOccurrence(seen, '12345', 2);
  registerJobOccurrence(seen, '12345', 5);
  assert.equal(seen.get('12345'), 2);
  // a third occurrence still resolves to the first, not the second
  assert.equal(registerJobOccurrence(seen, '12345', 9), 2);
});

test('registerJobOccurrence does not flag a job as a duplicate of itself (stale retry)', () => {
  const seen = new Map<string, number>();
  registerJobOccurrence(seen, '12345', 3);
  assert.equal(registerJobOccurrence(seen, '12345', 3), null);
});

test('registerJobOccurrence ignores jobs with no posting ID', () => {
  const seen = new Map<string, number>();
  assert.equal(registerJobOccurrence(seen, null, 0), null);
  assert.equal(registerJobOccurrence(seen, null, 1), null);
  assert.equal(seen.size, 0);
});

test('clearBlockingOverlays returns false when no overlay is ever visible', async () => {
  const page = createFakePage({
    locatorsBySelector: { [OVERLAY_SELECTOR]: createFakeLocator({ isVisible: () => false }) },
  });

  const dismissed = await clearBlockingOverlays(page, { timeoutMs: 50, pollIntervalMs: 5, requiredConsecutiveClear: 2 });
  assert.equal(dismissed, false);
});

test('clearBlockingOverlays clicks the dismiss button and reports it dismissed an overlay', async () => {
  let visible = true;
  const overlay = createFakeLocator({
    isVisible: () => visible,
    waitFor: () => {
      visible = false;
    },
  });
  const page = createFakePage({ locatorsBySelector: { [OVERLAY_SELECTOR]: overlay } });

  const dismissed = await clearBlockingOverlays(page, { timeoutMs: 500, pollIntervalMs: 5, requiredConsecutiveClear: 2 });
  assert.equal(dismissed, true);
});

test('clearBlockingOverlays keeps polling and gives up when the dismiss click never succeeds', async () => {
  const overlay = createFakeLocator({
    isVisible: () => true,
    click: () => {
      throw new Error('click intercepted by another overlay');
    },
  });
  const page = createFakePage({ locatorsBySelector: { [OVERLAY_SELECTOR]: overlay } });

  const dismissed = await clearBlockingOverlays(page, { timeoutMs: 30, pollIntervalMs: 5, requiredConsecutiveClear: 2 });
  assert.equal(dismissed, false);
});

test('scrollLoadPhase stops as soon as the see-more button becomes visible', async () => {
  const page = createFakePage({ evaluate: () => ['a', 'b', 'c', 'd', 'e'] });
  const seeMoreButton = createFakeLocator({ isVisible: () => true });
  const progressEvents: ScrapeProgressEvent[] = [];

  const count = await scrollLoadPhase(page, seeMoreButton, { onProgress: (e) => progressEvents.push(e) });

  assert.equal(count, 5);
  assert.deepEqual(progressEvents, [{ type: 'jobs:loading', count: 5 }]);
});

test('scrollLoadPhase stops once the unique job count is stable for three consecutive reads', async () => {
  const page = createFakePage({ evaluate: () => [] });
  const seeMoreButton = createFakeLocator({ isVisible: () => false });

  const count = await scrollLoadPhase(page, seeMoreButton);

  assert.equal(count, 0);
});

test('scrollLoadPhase stops after a caller-supplied maxScrollAttempts even when the job count keeps growing', async () => {
  let evaluateCalls = 0;
  const page = createFakePage({
    evaluate: () => {
      evaluateCalls += 1;
      return Array.from({ length: evaluateCalls }, (_, i) => `job-${i}`); // never stable — always a new unique count
    },
  });
  const seeMoreButton = createFakeLocator({ isVisible: () => false });

  await scrollLoadPhase(page, seeMoreButton, { maxScrollAttempts: 1 });

  // exactly one loop iteration: one collectJobIds() read + one scrollTo() side-effect call
  assert.equal(evaluateCalls, 2);
});

test('clickLoadPhase stops immediately when the "viewed all jobs" banner is visible', async () => {
  let clicked = false;
  const seeMoreButton = createFakeLocator({
    isVisible: () => true,
    click: () => {
      clicked = true;
    },
  });
  const page = createFakePage({
    locatorsBySelector: { [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({ isVisible: () => true }) },
  });

  await clickLoadPhase(page, seeMoreButton, 10);

  assert.equal(clicked, false);
});

test('clickLoadPhase stops immediately once the see-more button is no longer visible', async () => {
  let clicked = false;
  const seeMoreButton = createFakeLocator({
    isVisible: () => false,
    click: () => {
      clicked = true;
    },
  });
  const page = createFakePage({
    locatorsBySelector: { [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({ isVisible: () => false }) },
  });

  await clickLoadPhase(page, seeMoreButton, 10);

  assert.equal(clicked, false);
});

test('clickLoadPhase clicks the see-more button, waits for growth, and reports progress before stopping', async () => {
  let seeMoreVisibleCalls = 0;
  const seeMoreButton = createFakeLocator({
    isVisible: () => {
      seeMoreVisibleCalls += 1;
      return seeMoreVisibleCalls === 1; // visible once, gone on the next check
    },
  });
  const page = createFakePage({
    locatorsBySelector: {
      [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({ isVisible: () => false }),
      [OVERLAY_SELECTOR]: createFakeLocator({ isVisible: () => false }),
    },
    evaluate: () => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  });
  const progressEvents: ScrapeProgressEvent[] = [];

  await clickLoadPhase(page, seeMoreButton, 5, { onProgress: (e) => progressEvents.push(e) });

  assert.deepEqual(progressEvents, [{ type: 'jobs:loading', count: 8 }]);
});

test('clickLoadPhase honors a caller-supplied clickRetryAttempts instead of the default 4', async () => {
  let clickAttempts = 0;
  const seeMoreButton = createFakeLocator({
    isVisible: () => true,
    click: () => {
      clickAttempts += 1;
      throw new Error('click intercepted by another overlay');
    },
  });
  const page = createFakePage({
    locatorsBySelector: {
      [VIEWED_ALL_JOBS_SELECTOR]: createFakeLocator({ isVisible: () => false }),
      [OVERLAY_SELECTOR]: createFakeLocator({ isVisible: () => false }),
    },
  });

  await assert.rejects(() => clickLoadPhase(page, seeMoreButton, 0, { clickRetryAttempts: 1 }));
  assert.equal(clickAttempts, 1);
});

/** A single `getAttribute` call the scraper made against a job card. */
interface AttributeRead {
  name: string;
  options?: { timeout?: number };
}

/** Builds a fake job-list `<li>` locator matching the exact chain scrapeJob() reads. */
function makeJobLocator(opts: {
  title: string | null;
  listCompany: string | null;
  sourceJobId: string | null;
  sourceUrl?: string | null;
  onClick?: () => void;
  hasTitle?: boolean;
  /**
   * Simulates `.base-card` being absent from the markup. Playwright's
   * getAttribute auto-waits for the element and *rejects* on timeout — it
   * does not resolve to null — so this throws rather than returning null.
   */
  entityUrnUnreadable?: boolean;
  /** Collects every getAttribute call, so tests can assert reads are bounded. */
  attributeReads?: AttributeRead[];
}): Locator {
  const hasTitle = opts.hasTitle ?? true;
  return createFakeLocator({
    click: opts.onClick,
    locator: (selector) => {
      if (selector === 'h3') {
        return createFakeLocator({
          count: () => (hasTitle ? 1 : 0),
          innerText: () => {
            if (opts.title === null) throw new Error('no title element');
            return opts.title;
          },
        });
      }
      if (selector === LIST_COMPANY_SELECTOR) {
        return createFakeLocator({
          innerText: () => {
            if (opts.listCompany === null) throw new Error('no company element');
            return opts.listCompany;
          },
        });
      }
      if (selector === '.base-card') {
        return createFakeLocator({
          getAttribute: (name, options) => {
            opts.attributeReads?.push({ name, options });
            if (opts.entityUrnUnreadable) {
              throw new Error('locator.getAttribute: Timeout 30000ms exceeded');
            }
            return opts.sourceJobId ? `urn:li:fsd_jobPosting:${opts.sourceJobId}` : null;
          },
        });
      }
      if (selector === JOB_LINK_SELECTOR) {
        return createFakeLocator({
          getAttribute: (name, options) => {
            opts.attributeReads?.push({ name, options });
            return opts.sourceUrl ?? null;
          },
        });
      }
      return createFakeLocator();
    },
  });
}

/** Locators shared by every scrapeJob() test: no overlay ever appears, and the detail-pane title link is always found. */
function baseScrapeJobLocators(detailCompany: () => string | null, description = 'A description.') {
  return {
    [OVERLAY_SELECTOR]: createFakeLocator({ isVisible: () => false }),
    [COMPANY_SELECTOR]: createFakeLocator({
      innerText: () => {
        const company = detailCompany();
        if (company === null) throw new Error('no detail company element');
        return company;
      },
    }),
    [DESCRIPTION_SELECTOR]: createFakeLocator({ innerText: () => description }),
  };
}

test('scrapeJob returns a success result with the scraped title, company, and description', async () => {
  const jobItem = makeJobLocator({
    title: 'Frontend Developer',
    listCompany: 'Acme',
    sourceJobId: '111',
    sourceUrl: 'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
  });
  const page = createFakePage({
    locatorsBySelector: {
      [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
      ...baseScrapeJobLocators(() => 'Acme'),
    },
    defaultLocator: createFakeLocator({ waitFor: () => {}, isVisible: () => false }),
  });

  const result = await scrapeJob(page, 0, 1, { seenSourceJobIds: new Map(), runTimestamp: 123 });

  assert.equal(result.status, 'success');
  assert.equal(result.title, 'Frontend Developer');
  assert.equal(result.company, 'Acme');
  assert.equal(result.descriptionText, 'A description.');
  assert.equal(result.companyMismatch, false);
  assert.equal(result.lateOverlayDetected, false);
  assert.equal(result.sourceJobId, '111');
  assert.equal(result.sourceUrl, 'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111');
  assert.equal(result.sourceHostname, 'de.linkedin.com');
  assert.match(result.scrapedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(result.duplicateOfIdx, null);
});

test('scrapeJob skips a list item with no job title instead of scraping it as a job', async () => {
  const jobItem = makeJobLocator({ title: null, listCompany: null, sourceJobId: null, hasTitle: false });
  const page = createFakePage({
    locatorsBySelector: { [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }) },
  });

  const result = await scrapeJob(page, 7, 10, { seenSourceJobIds: new Map(), runTimestamp: 123 });

  assert.equal(result.status, 'skipped');
  assert.match(result.error ?? '', /not a real job card/i);
  assert.equal(result.index, 7);
  assert.equal(result.sourceJobId, null);
  assert.equal(result.sourceUrl, null);
  assert.equal(result.sourceHostname, null);
  assert.match(result.scrapedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('scrapeJob marks a repeated posting ID as a duplicate of its first occurrence', async () => {
  const jobItem = makeJobLocator({ title: 'Frontend Developer', listCompany: 'Acme', sourceJobId: '111' });
  const page = createFakePage({
    locatorsBySelector: {
      [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
      ...baseScrapeJobLocators(() => 'Acme'),
    },
    defaultLocator: createFakeLocator({ waitFor: () => {}, isVisible: () => false }),
  });
  const seenSourceJobIds = new Map<string, number>([['111', 0]]);

  const result = await scrapeJob(page, 3, 10, { seenSourceJobIds, runTimestamp: 123 });

  assert.equal(result.status, 'success');
  assert.equal(result.duplicateOfIdx, 0);
});

test('scrapeJob returns a failed result when an unexpected error is thrown', async () => {
  const jobItem = createFakeLocator({
    scrollIntoViewIfNeeded: () => {
      throw new Error('element detached from DOM');
    },
  });
  const page = createFakePage({
    locatorsBySelector: { [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }) },
  });

  const result = await scrapeJob(page, 2, 10, { seenSourceJobIds: new Map(), runTimestamp: 123 });

  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /element detached from DOM/);
  assert.equal(result.sourceJobId, null);
  assert.equal(result.sourceUrl, null);
  assert.equal(result.sourceHostname, null);
  assert.match(result.scrapedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('scrapeJob fails after the click but still keeps the sourceJobId/sourceUrl captured during identity read', async () => {
  const jobItem = makeJobLocator({
    title: 'Frontend Developer',
    listCompany: 'Acme',
    sourceJobId: '111',
    sourceUrl: 'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111',
    onClick: () => {
      throw new Error('click intercepted by another overlay');
    },
  });
  const page = createFakePage({
    locatorsBySelector: {
      [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
      [OVERLAY_SELECTOR]: createFakeLocator({ isVisible: () => false }),
    },
  });

  const result = await scrapeJob(page, 0, 1, { seenSourceJobIds: new Map(), runTimestamp: 123, clickRetryAttempts: 1 });

  assert.equal(result.status, 'failed');
  assert.equal(result.sourceJobId, '111');
  assert.equal(result.sourceUrl, 'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111');
  assert.equal(result.sourceHostname, 'www.linkedin.com');
});

/** Runs scrapeJob against one job card on an otherwise clean page (no overlay, detail pane resolves). */
async function scrapeSingleJob(jobItem: Locator, pageUrl?: string): Promise<JobResult> {
  const page = createFakePage({
    url: pageUrl ? () => pageUrl : undefined,
    locatorsBySelector: {
      [JOB_LIST_SELECTOR]: createFakeLocator({ nth: () => jobItem }),
      ...baseScrapeJobLocators(() => 'Acme'),
    },
    defaultLocator: createFakeLocator({ waitFor: () => {}, isVisible: () => false }),
  });
  return scrapeJob(page, 0, 1, { seenSourceJobIds: new Map(), runTimestamp: 123 });
}

test('scrapeJob resolves a relative job href against the search page URL', async () => {
  const jobItem = makeJobLocator({
    title: 'Frontend Developer',
    listCompany: 'Acme',
    sourceJobId: '111',
    sourceUrl: '/jobs/view/frontend-developer-at-acme-111',
  });

  const result = await scrapeSingleJob(jobItem, 'https://de.linkedin.com/jobs/search?keywords=frontend');

  assert.equal(result.sourceUrl, 'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111');
  assert.equal(result.sourceHostname, 'de.linkedin.com');
});

test('scrapeJob strips per-session tracking params so sourceUrl is stable across runs', async () => {
  const jobItem = makeJobLocator({
    title: 'Frontend Developer',
    listCompany: 'Acme',
    sourceJobId: '111',
    sourceUrl:
      'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111?refId=xY7%2Fabc&trackingId=Qk9%3D&position=3&pageNum=0&trk=public_jobs_jserp-result_search-card',
  });

  const result = await scrapeSingleJob(jobItem);

  assert.equal(result.sourceUrl, 'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111');
  assert.equal(result.sourceHostname, 'de.linkedin.com');
});

test('scrapeJob nulls sourceUrl and sourceHostname for an href with no hostname', async () => {
  // `new URL('javascript:void(0)')` parses without throwing and yields an
  // empty-string hostname, so this needs handling beyond a try/catch.
  const jobItem = makeJobLocator({
    title: 'Frontend Developer',
    listCompany: 'Acme',
    sourceJobId: '111',
    sourceUrl: 'javascript:void(0)',
  });

  const result = await scrapeSingleJob(jobItem);

  assert.equal(result.status, 'success');
  assert.equal(result.sourceUrl, null);
  assert.equal(result.sourceHostname, null);
});

test('scrapeJob returns a success result with null source URL fields when the card has no job link', async () => {
  const jobItem = makeJobLocator({
    title: 'Frontend Developer',
    listCompany: 'Acme',
    sourceJobId: '111',
    sourceUrl: null,
  });

  const result = await scrapeSingleJob(jobItem);

  assert.equal(result.status, 'success');
  assert.equal(result.sourceUrl, null);
  assert.equal(result.sourceHostname, null);
});

test('scrapeJob falls back to the href for sourceJobId when data-entity-urn is unreadable', async () => {
  const jobItem = makeJobLocator({
    title: 'Frontend Developer',
    listCompany: 'Acme',
    sourceJobId: null,
    entityUrnUnreadable: true,
    sourceUrl: 'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-4012345678?refId=abc',
  });

  const result = await scrapeSingleJob(jobItem);

  // A failed urn read must not take the whole identity down with it: the
  // posting ID is recoverable from the href, and duplicate detection plus
  // the detail-pane wait both depend on having it.
  assert.equal(result.status, 'success');
  assert.equal(result.sourceJobId, '4012345678');
  assert.equal(result.sourceUrl, 'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-4012345678');
});

test('scrapeJob bounds every card attribute read with an explicit timeout', async () => {
  // Without an explicit timeout these inherit Playwright's 30s default, so a
  // renamed class turns into half an hour of dead wait on a 120-job run.
  const attributeReads: AttributeRead[] = [];
  const jobItem = makeJobLocator({
    title: 'Frontend Developer',
    listCompany: 'Acme',
    sourceJobId: '111',
    sourceUrl: 'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
    attributeReads,
  });

  await scrapeSingleJob(jobItem);

  assert.ok(attributeReads.length >= 2, 'expected both the urn and href reads to be recorded');
  for (const read of attributeReads) {
    assert.ok(
      typeof read.options?.timeout === 'number' && read.options.timeout <= 1000,
      `getAttribute(${read.name}) was given no bounded timeout: ${JSON.stringify(read.options)}`
    );
  }
});

test('scrapeAllJobsOnce collects the indices of jobs whose detail-pane company mismatches the list', async () => {
  let currentDetailCompany = 'Acme';
  const cleanJob = makeJobLocator({
    title: 'Frontend Developer',
    listCompany: 'Acme',
    sourceJobId: '111',
    onClick: () => {
      currentDetailCompany = 'Acme';
    },
  });
  const staleJob = makeJobLocator({
    title: 'Backend Developer',
    listCompany: 'Acme',
    sourceJobId: '222',
    onClick: () => {
      currentDetailCompany = 'Globex Corporation';
    },
  });
  const jobLocators = [cleanJob, staleJob];
  const page = createFakePage({
    locatorsBySelector: {
      [JOB_LIST_SELECTOR]: createFakeLocator({ nth: (index) => jobLocators[index]! }),
      ...baseScrapeJobLocators(() => currentDetailCompany),
    },
    defaultLocator: createFakeLocator({ waitFor: () => {}, isVisible: () => false }),
  });

  const staleIndices = await scrapeAllJobsOnce(
    { page, totalJobs: 2, seenSourceJobIds: new Map(), runTimestamp: 123, delayBetweenJobsMs: 0 },
    []
  );

  assert.deepEqual(staleIndices, [1]);
});

test('scrapeAllJobsOnce emits job:done for a clean result and job:stale for a stale one', async () => {
  let currentDetailCompany = 'Acme';
  const cleanJob = makeJobLocator({
    title: 'Frontend Developer',
    listCompany: 'Acme',
    sourceJobId: '111',
    onClick: () => {
      currentDetailCompany = 'Acme';
    },
  });
  const staleJob = makeJobLocator({
    title: 'Backend Developer',
    listCompany: 'Acme',
    sourceJobId: '222',
    onClick: () => {
      currentDetailCompany = 'Globex Corporation';
    },
  });
  const jobLocators = [cleanJob, staleJob];
  const page = createFakePage({
    locatorsBySelector: {
      [JOB_LIST_SELECTOR]: createFakeLocator({ nth: (index) => jobLocators[index]! }),
      ...baseScrapeJobLocators(() => currentDetailCompany),
    },
    defaultLocator: createFakeLocator({ waitFor: () => {}, isVisible: () => false }),
  });
  const progressEvents: ScrapeProgressEvent[] = [];

  await scrapeAllJobsOnce(
    { page, totalJobs: 2, seenSourceJobIds: new Map(), runTimestamp: 123, delayBetweenJobsMs: 0, onProgress: (e) => progressEvents.push(e) },
    []
  );

  const doneIndices = progressEvents.filter((e) => e.type === 'job:done').map((e) => e.result.index);
  const staleEventIndices = progressEvents.filter((e) => e.type === 'job:stale').map((e) => e.result.index);
  assert.deepEqual(doneIndices, [0]);
  assert.deepEqual(staleEventIndices, [1]);
});

test('a job that comes back clean on a later scrapeAllJobsOnce pass emits job:done, replacing its earlier job:stale record (retry simulation)', async () => {
  let currentDetailCompany = 'Globex Corporation'; // mismatched on the first pass
  const jobLocators = [
    makeJobLocator({
      title: 'Backend Developer',
      listCompany: 'Acme',
      sourceJobId: '222',
      onClick: () => {}, // detail company left as-is by this click
    }),
  ];
  const page = createFakePage({
    locatorsBySelector: {
      [JOB_LIST_SELECTOR]: createFakeLocator({ nth: (index) => jobLocators[index]! }),
      ...baseScrapeJobLocators(() => currentDetailCompany),
    },
    defaultLocator: createFakeLocator({ waitFor: () => {}, isVisible: () => false }),
  });
  const firstPassEvents: ScrapeProgressEvent[] = [];
  const results: JobResult[] = [];
  const ctx = {
    page,
    totalJobs: 1,
    seenSourceJobIds: new Map<string, number>(),
    runTimestamp: 123,
    delayBetweenJobsMs: 0,
    onProgress: (e: ScrapeProgressEvent) => firstPassEvents.push(e),
  };

  await scrapeAllJobsOnce(ctx, results);
  assert.deepEqual(
    firstPassEvents.filter((e) => e.type === 'job:done' || e.type === 'job:stale').map((e) => e.type),
    ['job:stale']
  );
  assert.equal(results[0]?.companyMismatch, true);

  // Simulate the retry pass finding the detail pane settled down (clean now).
  currentDetailCompany = 'Acme';
  const secondPassEvents: ScrapeProgressEvent[] = [];
  await scrapeAllJobsOnce({ ...ctx, onProgress: (e) => secondPassEvents.push(e) }, results);

  assert.deepEqual(
    secondPassEvents.filter((e) => e.type === 'job:done' || e.type === 'job:stale').map((e) => e.type),
    ['job:done']
  );
  assert.equal(results[0]?.companyMismatch, false);
});

test('a job that is still stale on a later scrapeAllJobsOnce pass emits job:stale again (failed-retry simulation)', async () => {
  const currentDetailCompany = 'Globex Corporation'; // stays mismatched across both passes
  const jobLocators = [
    makeJobLocator({ title: 'Backend Developer', listCompany: 'Acme', sourceJobId: '222', onClick: () => {} }),
  ];
  const page = createFakePage({
    locatorsBySelector: {
      [JOB_LIST_SELECTOR]: createFakeLocator({ nth: (index) => jobLocators[index]! }),
      ...baseScrapeJobLocators(() => currentDetailCompany),
    },
    defaultLocator: createFakeLocator({ waitFor: () => {}, isVisible: () => false }),
  });
  const ctx = {
    page,
    totalJobs: 1,
    seenSourceJobIds: new Map<string, number>(),
    runTimestamp: 123,
    delayBetweenJobsMs: 0,
  };
  const results: JobResult[] = [];

  const firstPassEvents: ScrapeProgressEvent[] = [];
  await scrapeAllJobsOnce({ ...ctx, onProgress: (e) => firstPassEvents.push(e) }, results);
  const secondPassEvents: ScrapeProgressEvent[] = [];
  await scrapeAllJobsOnce({ ...ctx, onProgress: (e) => secondPassEvents.push(e) }, results);

  assert.deepEqual(
    firstPassEvents.filter((e) => e.type === 'job:done' || e.type === 'job:stale').map((e) => e.type),
    ['job:stale']
  );
  assert.deepEqual(
    secondPassEvents.filter((e) => e.type === 'job:done' || e.type === 'job:stale').map((e) => e.type),
    ['job:stale']
  );
});
