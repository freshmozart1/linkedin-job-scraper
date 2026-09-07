import type { Page } from 'playwright';
import type { JobBudget } from '../types';
import { DETAIL_TITLE_LINK_SELECTOR } from '../selectors';
import { boundedTimeout } from './jobBudget';
import type { StaleDiagnosticsRecorder } from './createStaleDiagnostics';

// The detail pane re-renders client-side after a click; networkidle alone
// doesn't guarantee that DOM patch has landed (it only tracks network quiet
// time), so wait for the detail pane's own title link to actually reference
// this job's ID before trusting its content.
//
// Both waits are best-effort already (`.catch(() => {})`), so clamping them
// to the job's remaining budget only ever makes this give up sooner and hand
// the — possibly stale — pane to the reads below, which is exactly what
// isStaleResult exists to catch.
//
// `diagnostics` (optional, so omitting it leaves this byte-identical for
// direct callers of the exported scrapeJob) records what each wait DID.
// Deliberately only that: the `.catch(() => {})`s stay, and so does every
// timeout. GitHub issue #29 suspects this exact silent give-up of producing
// a third of a run's suspect results, and the point of the diagnostic phase
// is to *report* the swallowed timeout — measured against the clamped value
// Playwright was actually handed, so a wait cut short by a spent per-job
// budget stays distinguishable from one that genuinely ran out. Changing
// what happens on it is a later phase's job, and one that should be designed
// from this data rather than guessed at ahead of it.
export async function waitForJobDetailToLoad(
    page: Page,
    sourceJobId: string | null,
    budget?: JobBudget,
    diagnostics?: StaleDiagnosticsRecorder,
): Promise<void> {
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
        diagnostics?.record({
            titleLinkWait: {
                outcome,
                elapsedMs: Date.now() - startedAt,
                timeoutMs,
            },
        });
    } else {
        // A card with no sourceJobId skips this wait entirely — which is the
        // single condition CLAUDE.md already names as "the exact condition
        // that manufactures stale results", so it is recorded as its own
        // outcome rather than left absent and mistaken for "never reached".
        diagnostics?.record({
            titleLinkWait: { outcome: 'skipped', elapsedMs: 0, timeoutMs: 0 },
        });
    }

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
}
