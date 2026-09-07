import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import type { Page } from 'playwright';
import { readDetailPaneSnapshot } from '../src/scraper/readDetailPaneSnapshot';
import { readOverlayDiagnostics } from '../src/scraper/readOverlayDiagnostics';

function serializedPage(document: unknown): {
    page: Page;
    sources: string[];
} {
    const sources: string[] = [];
    const page = {
        evaluate: async (pageFunction: unknown, arg: unknown) => {
            const source = String(pageFunction);
            sources.push(source);
            return runInNewContext(`(${source})(argument)`, {
                argument: arg,
                document,
            });
        },
    } as unknown as Page;
    return { page, sources };
}

describe('browser evaluate callback serialization', () => {
    it('captures a detail-pane snapshot with no module-scope helper', async ({
        assert,
    }) => {
        const pane = {
            outerHTML: '<section class="two-pane"> Detail </section>',
            textContent: 'Detail',
            classList: ['two-pane'],
            getAttribute: () => null,
        };
        const description = {
            ...pane,
            outerHTML: '<div>Description</div>',
            textContent: 'A   description',
        };
        const title = {
            ...pane,
            getAttribute: (name: string) =>
                name === 'href' ? '/jobs/view/example-111' : null,
        };
        const org = { ...pane, textContent: ' Acme  GmbH ' };
        const overlay = {
            ...pane,
            classList: ['modal__overlay--visible'],
        };
        const { page, sources } = serializedPage({
            body: pane,
            querySelector: (selector: string) => {
                if (selector.includes('detail-view')) return pane;
                if (selector.includes('description__text')) return description;
                return null;
            },
            querySelectorAll: (selector: string) => {
                if (selector.includes('topcard-title')) return [title];
                if (selector.includes('topcard__org-name-link')) return [org];
                if (selector.includes('modal__overlay--visible')) return [overlay];
                return [];
            },
        });

        const result = await readDetailPaneSnapshot(page, 4000);

        assert.equal(sources[0]?.includes('__name'), false);
        assert.equal(result?.html, '<section class="two-pane"> Detail </section>');
        assert.deepEqual(result?.titleLinkHrefs, ['/jobs/view/example-111']);
        assert.deepEqual(result?.orgNames, ['Acme GmbH']);
        assert.equal(result?.descriptionLength, 13);
    });

    it('reads overlay diagnostics with no module-scope helper', async ({
        assert,
    }) => {
        const buttons = [
            {
                getAttribute: (name: string) =>
                    name === 'aria-label' ? ' Close ' : null,
                textContent: '',
            },
        ];
        const { page, sources } = serializedPage({
            querySelector: () => ({
                textContent: ' Sign in   to view more jobs ',
                classList: ['modal__overlay--visible'],
                querySelectorAll: () => buttons,
            }),
        });

        const result = await readOverlayDiagnostics(page);

        assert.equal(sources[0]?.includes('__name'), false);
        assert.equal(result?.text, 'Sign in to view more jobs');
        assert.deepEqual(result?.buttonNames, ['Close']);
    });
});
