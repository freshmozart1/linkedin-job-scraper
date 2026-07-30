import type { Page } from 'playwright';
import { sleep } from './sleep';
import { scrollToListItem } from './scrollToListItem';

// LinkedIn's own automatic infinite scroll caps out around 120 items before
// switching to the manual "See more jobs" button (see scrollLoadPhase.ts's
// top comment) — this bound is a defensive backstop against an unbounded
// loop, the same way pollForNewJobs (./pollForNewJobs) caps its own poll
// count, and should never actually be reached in practice. It also bounds
// the reset-and-rewalk path below, so a repeatedly shrinking list still
// can't loop forever.
const MAX_LIST_ITEMS_PER_SCROLL_PASS = 200;

// Scrolls exactly one <li> at a time — never a single instant jump —
// because LinkedIn's lazy-load listener only reacts to genuine incremental
// scroll progress (see scrollLoadPhase.ts's top comment). Re-checks the
// live <li> at each index rather than reading the list's length once, since
// LinkedIn appends more <li>s to the same <ul> once scrolled past whatever
// was rendered initially — that's also why this resumes from `fromIndex`
// instead of restarting at 0 every phase iteration. Returns the index of
// the first <li> not found, i.e. how many were scrolled through this call.
//
// LinkedIn's guest infinite scroll can also, on a long enough session, stop
// returning genuinely new pages and instead re-serve an earlier, shorter
// one (collectJobIds.ts documents this as real). Resuming from a fixed
// `fromIndex` that no longer exists in that shorter list would otherwise
// stall forever — every subsequent call finds nothing at that index and
// returns it unchanged. `scrollToListItem` reports the live `renderedCount`
// on every step, so a `null` height that's caused by an actual shrink
// (`renderedCount < index`) is told apart from the ordinary "nothing new
// rendered yet" case (the same `null`, but `renderedCount >= index`) and
// resets the walk to the top instead of stalling.
//
// CRAP score here is another instance of fallow's *estimated* (not
// instrumented) coverage defaulting to 0% — the same situation as
// scrollLoadPhase.ts, verified via `fallow check_health`; the 5
// scrollLoadPhase tests in test/scrollLoadPhase.test.ts exercise this
// function's branches indirectly, including the reset path this file adds.
// fallow-ignore-next-line complexity
export async function scrollNewlyRenderedListItems(
    page: Page,
    fromIndex: number,
): Promise<number> {
    let index = fromIndex;
    for (
        let scrolled = 0;
        scrolled < MAX_LIST_ITEMS_PER_SCROLL_PASS;
        scrolled++
    ) {
        const { height, renderedCount } = await scrollToListItem(
            page,
            index,
        );
        if (height !== null) {
            index += 1;
            await sleep(120);
            continue;
        }
        if (index > 0 && renderedCount < index) {
            index = 0;
            continue;
        }
        break;
    }
    return index;
}
