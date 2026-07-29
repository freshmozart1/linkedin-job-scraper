import { describe, it } from 'node:test';
import { isCompanyMismatch } from '../src';

describe('isCompanyMismatch()', () => {
    it('is false when the list company could not be read', ({ assert }) => {
        assert.equal(
            isCompanyMismatch({
                listCompany: null,
                detailCompany: 'Acme Corp',
            }),
            false,
        );
    });

    it('is false when the detail company could not be read', ({ assert }) => {
        assert.equal(
            isCompanyMismatch({
                listCompany: 'Acme Corp',
                detailCompany: null,
            }),
            false,
        );
    });

    it('is false when both sides match verbatim', ({ assert }) => {
        assert.equal(
            isCompanyMismatch({
                listCompany: 'Acme Corp',
                detailCompany: 'Acme Corp',
            }),
            false,
        );
    });

    it('ignores surrounding whitespace differences when comparing', ({
        assert,
    }) => {
        assert.equal(
            isCompanyMismatch({
                listCompany: 'Acme Corp',
                detailCompany: '  Acme Corp  ',
            }),
            false,
        );
    });

    it('is true when the companies genuinely differ', ({ assert }) => {
        assert.equal(
            isCompanyMismatch({
                listCompany: 'Acme Corp',
                detailCompany: 'Zellerfeld Shoe Company Inc.',
            }),
            true,
        );
    });
});
