import { describe, it } from 'node:test';
import { hostnameOf } from '../src';

describe('hostnameOf()', () => {
    it('reads the hostname off a job URL', ({ assert }) => {
        assert.equal(
            hostnameOf(
                'https://de.linkedin.com/jobs/view/frontend-developer-at-acme-111',
            ),
            'de.linkedin.com',
        );
    });

    it('returns null for a scheme with no hostname', ({ assert }) => {
        // `new URL()` parses these without throwing, but `.hostname` comes
        // back as '', not an error — the `|| null` in hostnameOf is what
        // catches that.
        assert.equal(hostnameOf('javascript:void(0)'), null);
        assert.equal(hostnameOf('mailto:someone@example.com'), null);
    });

    it('returns null for a string that is not a URL at all', ({ assert }) => {
        assert.equal(hostnameOf('not a url'), null);
    });

    it('returns null for missing input', ({ assert }) => {
        assert.equal(hostnameOf(null), null);
        assert.equal(hostnameOf(undefined), null);
    });
});
