import { spawnSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

const repositoryRoot = resolve(__dirname, '..');

function createBuildFixture(t: TestContext): string {
    const directory = mkdtempSync(join(tmpdir(), 'linkedin-build-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    for (const entry of ['package.json', 'tsconfig.json', 'src']) {
        cpSync(join(repositoryRoot, entry), join(directory, entry), {
            recursive: true,
        });
    }
    // Use installed tools without installing or touching the caller's dist.
    // A junction also works on Windows without symbolic-link privileges.
    symlinkSync(
        realpathSync(join(repositoryRoot, 'node_modules')),
        join(directory, 'node_modules'),
        'junction',
    );
    return directory;
}

function runLifecycle(
    t: TestContext,
    directory: string,
    lifecycle: string,
): void {
    const result = spawnSync(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['run', lifecycle],
        {
            cwd: directory,
            encoding: 'utf8',
            shell: process.platform === 'win32',
            timeout: 60000,
        },
    );
    t.assert.equal(
        result.status,
        0,
        `${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`,
    );
}

async function assertCurrentPackage(
    t: TestContext,
    directory: string,
): Promise<void> {
    const fixtureRequire = createRequire(join(directory, 'package.json'));
    const built = fixtureRequire('./') as typeof import('../src');
    const currentScraper = fixtureRequire(
        './dist/scraper/index.js',
    ) as typeof import('../src/scraper');
    t.assert.equal(typeof built.runScrape, 'function');
    t.assert.equal(typeof built.ScrapeAbortedError, 'function');
    t.assert.equal(built.runScrape, currentScraper.runScrape);
    t.assert.equal(
        built.ScrapeAbortedError,
        currentScraper.ScrapeAbortedError,
    );
    const manifest = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8'),
    );
    t.assert.ok(existsSync(join(directory, manifest.types)));

    // Exercises the built public API without launching Chromium or making requests.
    const controller = new AbortController();
    controller.abort();
    await t.assert.rejects(
        built.runScrape({
            searchParams: { keyword: 'build regression' },
            signal: controller.signal,
        }),
        built.ScrapeAbortedError,
    );
}

describe('package build lifecycle', () => {
    for (const lifecycle of ['build', 'prepare']) {
        it(`${lifecycle} removes obsolete output before resolving the package main`, async (t) => {
            const directory = createBuildFixture(t);
            mkdirSync(join(directory, 'dist'));
            // Before v0.4.7, scraper.ts emitted this file. Node loads it ahead
            // of scraper/index.js after the source moved into a directory.
            const obsoleteFiles = [
                'scraper.js',
                'scraper.d.ts',
                'scraper.js.map',
            ];
            for (const file of obsoleteFiles) {
                writeFileSync(
                    join(directory, 'dist', file),
                    'module.exports = {};',
                );
            }

            runLifecycle(t, directory, lifecycle);

            for (const file of obsoleteFiles) {
                t.assert.equal(
                    existsSync(join(directory, 'dist', file)),
                    false,
                    file,
                );
            }
            await assertCurrentPackage(t, directory);
        });
    }

    it('prepare builds a fresh package when dist does not exist', async (t) => {
        const directory = createBuildFixture(t);

        runLifecycle(t, directory, 'prepare');

        await assertCurrentPackage(t, directory);
    });
});
