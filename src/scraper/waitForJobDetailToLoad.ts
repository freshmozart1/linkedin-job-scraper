import type { Page } from 'playwright';
import type {
    DetailPaneIdentityObservation,
    JobBudget,
    WaitObservation,
} from '../types';
import { DETAIL_TITLE_LINK_SELECTOR } from '../selectors';
import { boundedTimeout } from './jobBudget';
import type { StaleDiagnosticsRecorder } from './createStaleDiagnostics';
import { jobIdFromUrl, normalizeJobUrl } from '../url';

// The detail pane re-renders client-side after a click; networkidle alone
// doesn't guarantee that DOM patch has landed (it only tracks network quiet
// time), so wait for the detail pane's own title link to actually reference
// this job's ID before trusting its content.
//
// The visibility wait is a trigger, not proof: after it resolves (or times
// out), the actual first title-link href is parsed with the same URL pipeline
// used everywhere else. Detail fields are only allowed after the full parsed
// ID matches. Once it does, networkidle remains a best-effort content-settling
// wait and the identity is checked again immediately afterward.
//
// `diagnostics` records both the best-effort wait and the exact comparison.
// A timeout no longer falls through to detail reads: the caller gets
// `matched: false` and may perform its one immediate recovery re-click.
export async function waitForJobDetailToLoad(
    page: Page,
    sourceJobId: string | null,
    budget?: JobBudget,
    diagnostics?: StaleDiagnosticsRecorder,
    attempt: DetailPaneIdentityObservation['attempt'] = 'initial',
): Promise<DetailPaneIdentityObservation> {
    let titleLinkWait: WaitObservation;
    if (sourceJobId) {
        const timeoutMs = boundedTimeout(budget, 8000);
        const startedAt = Date.now();
        // Assigned from inside the existing catch rather than by wrapping the
        // await in a try, so the control flow below is the same statement it
        // has always been. A visibility wait has no realistic rejection other
        // than its own timeout, so every swallowed one is recorded as that.
        let outcome: 'resolved' | 'timedOut' = 'resolved';
        await page
            .locator(`${DETAIL_TITLE_LINK_SELECTOR}[href*="-${sourceJobId}"]`)
            .first()
            .waitFor({
                state: 'visible',
                timeout: timeoutMs,
            })
            .catch(() => {
                outcome = 'timedOut';
            });
        titleLinkWait = {
            outcome,
            elapsedMs: Date.now() - startedAt,
            timeoutMs,
        };
    } else {
        // Normal scrapeJob callers reject a missing sourceJobId before the
        // click. Keep direct helper calls explicit rather than confusing
        // "could not verify" with "never reached" in their diagnostics.
        titleLinkWait = { outcome: 'skipped', elapsedMs: 0, timeoutMs: 0 };
    }

    if (attempt === 'initial') diagnostics?.record({ titleLinkWait });

    budget?.check();
    let identity = await readIdentity(page, sourceJobId, budget);

    if (identity.matched) {
        const networkIdleTimeoutMs = boundedTimeout(budget, 5000);
        const networkIdleStartedAt = Date.now();
        let networkIdleOutcome: 'resolved' | 'timedOut' = 'resolved';
        await page
            .waitForLoadState('networkidle', {
                timeout: networkIdleTimeoutMs,
            })
            .catch(() => {
                networkIdleOutcome = 'timedOut';
            });
        diagnostics?.record({
            networkIdleWait: {
                outcome: networkIdleOutcome,
                elapsedMs: Date.now() - networkIdleStartedAt,
                timeoutMs: networkIdleTimeoutMs,
            },
        });
        budget?.check();
        identity = await readIdentity(page, sourceJobId, budget);
    }

    const observation: DetailPaneIdentityObservation = {
        attempt,
        expectedJobId: sourceJobId,
        detailTitleHref: identity.detailTitleHref,
        detailJobId: identity.detailJobId,
        matched: identity.matched,
        wait: titleLinkWait,
    };
    diagnostics?.record({
        detailTitleHref: identity.detailTitleHref,
        detailJobId: identity.detailJobId,
    });
    diagnostics?.recordDetailIdentityCheck(observation);
    return observation;
}

async function readIdentity(
    page: Page,
    sourceJobId: string | null,
    budget?: JobBudget,
): Promise<{
    detailTitleHref: string | null;
    detailJobId: string | null;
    matched: boolean;
}> {
    const detailTitleHref = await page
        .locator(DETAIL_TITLE_LINK_SELECTOR)
        .first()
        .getAttribute('href', { timeout: boundedTimeout(budget, 1000) })
        .catch(() => null);
    budget?.check();
    const detailJobId = jobIdFromUrl(
        normalizeJobUrl(detailTitleHref, page.url()),
    );
    return {
        detailTitleHref,
        detailJobId,
        matched: sourceJobId !== null && detailJobId === sourceJobId,
    };
}
