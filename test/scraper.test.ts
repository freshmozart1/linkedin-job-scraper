import test from 'node:test';
import assert from 'node:assert/strict';
import type { Locator } from 'playwright';
import {
  isCompanyMismatch,
  isStaleResult,
  registerJobOccurrence,
  buildSearchUrl,
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

/** Builds a fake job-list `<li>` locator matching the exact chain scrapeJob() reads. */
function makeJobLocator(opts: {
  title: string | null;
  listCompany: string | null;
  sourceJobId: string | null;
  sourceUrl?: string | null;
  onClick?: () => void;
  hasTitle?: boolean;
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
          getAttribute: () => (opts.sourceJobId ? `urn:li:fsd_jobPosting:${opts.sourceJobId}` : null),
        });
      }
      if (selector === JOB_LINK_SELECTOR) {
        return createFakeLocator({ getAttribute: () => opts.sourceUrl ?? null });
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

  const result = await scrapeJob(page, 0, 1, { seenJobIds: new Map(), runTimestamp: 123 });

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

  const result = await scrapeJob(page, 7, 10, { seenJobIds: new Map(), runTimestamp: 123 });

  assert.equal(result.status, 'skipped');
  assert.match(result.error ?? '', /not a real job card/i);
  assert.equal(result.index, 7);
  assert.equal(result.sourceJobId, null);
  assert.equal(result.sourceUrl, null);
  assert.equal(result.sourceHostname, null);
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
  const seenJobIds = new Map<string, number>([['111', 0]]);

  const result = await scrapeJob(page, 3, 10, { seenJobIds, runTimestamp: 123 });

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

  const result = await scrapeJob(page, 2, 10, { seenJobIds: new Map(), runTimestamp: 123 });

  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /element detached from DOM/);
  assert.equal(result.sourceJobId, null);
  assert.equal(result.sourceUrl, null);
  assert.equal(result.sourceHostname, null);
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

  const result = await scrapeJob(page, 0, 1, { seenJobIds: new Map(), runTimestamp: 123, clickRetryAttempts: 1 });

  assert.equal(result.status, 'failed');
  assert.equal(result.sourceJobId, '111');
  assert.equal(result.sourceUrl, 'https://www.linkedin.com/jobs/view/frontend-developer-at-acme-111');
  assert.equal(result.sourceHostname, 'www.linkedin.com');
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
    { page, totalJobs: 2, seenJobIds: new Map(), runTimestamp: 123, delayBetweenJobsMs: 0 },
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
    { page, totalJobs: 2, seenJobIds: new Map(), runTimestamp: 123, delayBetweenJobsMs: 0, onProgress: (e) => progressEvents.push(e) },
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
    seenJobIds: new Map<string, number>(),
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
    seenJobIds: new Map<string, number>(),
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
