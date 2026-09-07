import { it } from 'node:test';
import type { JobBudget } from '../src';
import { createStaleDiagnostics } from '../src/scraper/createStaleDiagnostics';
import { readJobDetailPane } from '../src/scraper/readJobDetailPane';
import {
    createFakeJobLocator,
    createFakeLocator,
    createFakePage,
} from './helpers/fakePlaywright';
import { baseScrapeJobLocators } from './helpers/baseScrapeJobLocators';

it('marks a requested snapshot skipped when too little job budget remains', async ({
    assert,
}) => {
    const jobItem = createFakeJobLocator({
        title: 'Software Engineer',
        listCompany: 'Acme',
        sourceJobId: '111',
    });
    const page = createFakePage({
        locatorsBySelector: baseScrapeJobLocators(() => 'Acme'),
        defaultLocator: createFakeLocator({ isVisible: () => false }),
    });
    const budget: JobBudget = {
        deadline: Date.now() + 100,
        boundedTimeout: (cap) => Math.min(cap, 100),
        check: () => {},
        remaining: () => 100,
    };
    const recorder = createStaleDiagnostics({
        runId: 'run-budget',
        totalJobs: 1,
        index: 0,
        settings: { domSnapshot: true, snapshotEveryJob: true },
    });

    await readJobDetailPane(jobItem, page, '111', undefined, budget, recorder);
    const record = recorder.finalize();

    assert.equal(record.snapshotOutcome, 'skipped-budget');
    assert.equal(record.snapshot, null);
    assert.equal(record.snapshotError, null);
    assert.equal(
        record.overlayChecks.find((check) => check.phase === 'late')?.ran,
        false,
    );
});
