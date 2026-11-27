/**
 * Unit tests for wms_lib_period (Phase 4 / invariant #16, PF-24/25). No account.
 */
const period = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_period.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('decide - single book', () => {
    test('open period posts', () => {
        expect(period.decide({ closed: false })).toEqual({ ok: true });
    });
    test('closed period raises CLOSED_PERIOD_POSTING (pre-check, not a caught failure)', () => {
        expect(period.decide({ closed: true })).toEqual({ ok: false, reasonCode: 'CLOSED_PERIOD_POSTING' });
    });
});

describe('decide - Multi-Book (PF-25)', () => {
    const books = [{ book: '1', closed: true }, { book: '2', closed: false }];
    test('target book open -> posts even though another book is closed', () => {
        expect(period.decide({ multiBook: true, bookStatuses: books, targetBook: '2' })).toEqual({ ok: true });
    });
    test('target book closed -> blocked', () => {
        expect(period.decide({ multiBook: true, bookStatuses: books, targetBook: '1' }).reasonCode).toBe('CLOSED_PERIOD_POSTING');
    });
    test('no target named -> any closed book blocks (fail-safe)', () => {
        expect(period.decide({ multiBook: true, bookStatuses: books }).reasonCode).toBe('CLOSED_PERIOD_POSTING');
    });
});

describe('errors', () => {
    test('missing periodInfo throws', () => {
        expect(grab(() => period.decide(null)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
