/**
 * Live diagnostic runner for GitHub issue #29 — "~a third of scraped jobs
 * come back suspect and are discarded".
 *
 *     npx tsx scripts/diagnose-stale.ts [--runs 3] [--keyword "..."]
 *                                       [--keywords "a,b,c"]
 *                                       [--location "..."] [--jobs 30]
 *                                       [--out DIR] [--headless|--headed]
 *
 * `--keywords` is the knob that matters: it scrapes that many searches
 * *concurrently*, one browser each, the way this repo's consumer fans out one
 * `runScrape` per keyword. See the `keywords` constant below — the suspected
 * mechanism is a race, so how much CPU the page is competing for is a
 * variable to control rather than one to assume away.
 *
 * Imports `src/` directly through tsx, so there is no build step between
 * editing the scraper and re-running this. It is deliberately NOT part of
 * `tsconfig.json` (only of `tsconfig.test.json`, so `npm run typecheck`
 * still covers it) — a debugging script has no business in the package's
 * published `dist/`.
 *
 * The defaults reproduce the issue's own repro exactly: `software engineer`
 * in Berlin, 25km, past 24 hours, 30 job indices, unauthenticated. Three
 * runs by default, because the issue's evidence is two runs and a third
 * makes "roughly a third every time" distinguishable from "twice in a row".
 *
 * Each run/keyword pair writes its own collision-proof JSON so nothing is
 * lost if a later scrape dies. A final combined JSON includes the experiment
 * configuration and every completed scrape's records, and the summary printed
 * at the end is over those records together.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
    describeStaleReport,
    isStaleResult,
    runScrape,
    summarizeStaleDiagnostics,
} from '../src';
import type {
    ScrapeProgressEvent,
    SearchParams,
    StaleDiagnostics,
    StaleReport,
} from '../src';

const { values } = parseArgs({
    options: {
        runs: { type: 'string' },
        keyword: { type: 'string' },
        keywords: { type: 'string' },
        location: { type: 'string' },
        jobs: { type: 'string' },
        out: { type: 'string' },
        headless: { type: 'boolean' },
        headed: { type: 'boolean' },
    },
});

const runs = positiveInt(values.runs, 3);
const maxJobs = positiveInt(values.jobs, 30);
const outDir = values.out ?? 'diagnostics';
// `--headed` wins if both are somehow passed: asking to watch a run is the
// more specific request, and a headed run is the one you only get by asking.
const headless = values.headed ? false : (values.headless ?? true);

/**
 * The keywords scraped **concurrently** within one run, which is the single
 * most important knob here and the reason `--keywords` exists alongside
 * `--keyword`.
 *
 * `runScrape` launches its own browser per call, and this repo's consumer
 * (jobMatchServer) fans out one call per keyword through
 * `Promise.allSettled` — so the environment GitHub issue #29 was observed in
 * was N Chromium instances rendering at once on one machine, not the single
 * quiet browser a one-keyword run gives you. Since the suspected mechanism is
 * the detail pane losing a race against its own read, how much CPU the page
 * is competing for is a variable that has to be controlled rather than
 * assumed away.
 *
 * `--keyword a --keywords a,b,c` therefore reads as the A/B it is: same
 * search, one browser versus three.
 */
const keywords = (values.keywords ?? values.keyword ?? 'software engineer')
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);

const baseSearchParams: Omit<SearchParams, 'keyword'> = {
    location: values.location ?? 'Berlin',
    // LinkedIn's guest search takes miles; 16 is the ~25km the issue's repro
    // uses. Sent as-is rather than converted, so what lands in the URL is
    // exactly what was asked for.
    distanceMiles: 16,
    datePosted: 'day',
};

async function main(): Promise<void> {
    mkdirSync(outDir, { recursive: true });
    const allRecords: StaleDiagnostics[] = [];
    const experimentId = `${fileTimestamp()}-${randomUUID().slice(0, 8)}`;
    const completed: CompletedScrape[] = [];

    for (let run = 1; run <= runs; run++) {
        console.log(
            `\n=== run ${run}/${runs} — [${keywords.join(', ')}] in ${baseSearchParams.location},` +
                ` ${maxJobs} jobs each, ${keywords.length} concurrent ===`,
        );
        // All keywords at once, exactly the way jobMatchServer fans them out
        // — the contention that produces is the variable under test, so it
        // has to be produced the same way rather than approximated by running
        // them one after another.
        const settled = await Promise.allSettled(
            keywords.map((keyword) => scrapeOne(run, keyword, experimentId)),
        );
        // Each record carries its own runId, so concurrent searches and
        // repeated index ranges remain unambiguous when combined.
        for (const [i, outcome] of settled.entries()) {
            const keyword = keywords[i] ?? '?';
            if (outcome.status === 'rejected') {
                // One keyword dying must not cost the whole invocation the
                // runs that would have followed it — a non-deterministic bug
                // is exactly the kind that takes several attempts to catch.
                const { reason } = outcome;
                console.error(
                    `run ${run} keyword "${keyword}" failed: ${reason instanceof Error ? reason.message : String(reason)}`,
                );
                continue;
            }
            if (!outcome.value) continue;
            completed.push(outcome.value);
            allRecords.push(...outcome.value.report.records);
        }
        const runRecords = settled.flatMap((outcome) =>
            outcome.status === 'fulfilled' && outcome.value
                ? outcome.value.report.records
                : [],
        );
        if (runRecords.length > 0) {
            console.log(`\n--- run ${run} ---`);
            console.log(
                describeStaleReport(summarizeStaleDiagnostics(runRecords)),
            );
        }
    }

    console.log(
        `\n=== all ${runs} runs × ${keywords.length} concurrent, combined ===`,
    );
    const report = summarizeStaleDiagnostics(allRecords);
    console.log(describeStaleReport(report));
    const combinedFile = join(
        outDir,
        `stale-combined-${experimentId}.json`,
    );
    writeFileSync(
        combinedFile,
        JSON.stringify(
            {
                experimentId,
                configuration: {
                    runs,
                    keywords,
                    location: baseSearchParams.location,
                    distanceMiles: baseSearchParams.distanceMiles,
                    datePosted: baseSearchParams.datePosted,
                    maxJobs,
                    headless,
                    concurrency: keywords.length,
                },
                completed: completed.map(({ report: _report, ...metadata }) =>
                    metadata,
                ),
                report,
            },
            null,
            2,
        ),
    );
    console.log(`wrote ${combinedFile}`);
}

interface CompletedScrape {
    run: number;
    keyword: string;
    /** Joins this search's metadata to its records in the combined report. */
    runId: string | null;
    totalJobs: number;
    url: string;
    stoppedEarly: string | null;
    report: StaleReport;
}

/**
 * One keyword's scrape, written out per keyword so `Promise.allSettled` can
 * fan them out. Resolves to that scrape's report, or `null` when diagnostics
 * produced none — a rejection is left to the caller to log, since only it
 * knows which run and keyword it belonged to.
 */
async function scrapeOne(
    run: number,
    keyword: string,
    experimentId: string,
): Promise<CompletedScrape | null> {
    const searchParams: SearchParams = { ...baseSearchParams, keyword };
    const outcome = await runScrape({
        searchParams,
        onProgress: (event) => logProgress(keyword, event),
        scraperOptions: {
            headless,
            maxJobs,
            // snapshotEveryJob is on for the same reason the healthy jobs are
            // recorded at all: telling a stale pane apart from a
            // partially-rendered or interstitial one needs a healthy pane to
            // compare it against.
            staleDiagnostics: {
                domSnapshot: true,
                snapshotEveryJob: true,
            },
        },
    });
    const report = outcome.staleReport;
    if (!report) {
        console.error(`"${keyword}" produced no stale report; skipping it`);
        return null;
    }
    const file = join(
        outDir,
        `stale-${experimentId}-run-${run}-${slug(keyword)}.json`,
    );
    const completed: CompletedScrape = {
        run,
        keyword,
        runId: report.records[0]?.runId ?? null,
        totalJobs: report.records[0]?.totalJobs ?? 0,
        url: outcome.url,
        stoppedEarly: outcome.stoppedEarly ?? null,
        report,
    };
    writeFileSync(
        file,
        JSON.stringify(
            {
                experimentId,
                ...completed,
                searchParams,
                maxJobs,
                headless,
                concurrency: keywords.length,
            },
            null,
            2,
        ),
    );
    console.log(`wrote ${file}`);
    return completed;
}

/**
 * Prints one line per job as it happens, so a 30-job run is never silently
 * quiet for minutes. Prefixed with the keyword because concurrent scrapes
 * interleave their output — without it the lines from three browsers read as
 * one incoherent run.
 */
function logProgress(keyword: string, event: ScrapeProgressEvent): void {
    if (event.type === 'jobs:found') {
        console.log(`[${keyword}] found ${event.total} jobs to scrape`);
        return;
    }
    if (event.type === 'overlay:undismissed') {
        console.log(
            `[${keyword}]   overlay undismissed (neutralized=${event.neutralized})`,
        );
        return;
    }
    if (event.type !== 'job:done' && event.type !== 'job:stale') return;
    const { result, diagnostics } = event;
    const marker = isStaleResult(result) ? 'STALE' : result.status;
    console.log(
        `[${keyword}]   [${result.index}] ${marker}` +
            ` combination=${diagnostics?.combination ?? '?'}` +
            ` titleLinkWait=${diagnostics?.titleLinkWait?.outcome ?? '?'}` +
            ` clickAttempts=${diagnostics?.clickAttempts ?? '?'}`,
    );
}

/** `:` is legal in a POSIX filename but awkward in every shell, so the ISO stamp is flattened. */
function fileTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function positiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    return raw !== undefined && Number.isInteger(parsed) && parsed > 0
        ? parsed
        : fallback;
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
