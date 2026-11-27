/**
 * Unit tests for wms_lib_availability (Phase 4 / invariant #19, D-48). No account.
 */
const avail = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_availability.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('sufficient stock posts', () => {
    test('plain/lot/serial all post when on hand covers it', () => {
        expect(avail.check({ mode: 'PLAIN', onHand: 10, requested: 5 })).toEqual({ ok: true });
        expect(avail.check({ mode: 'LOT', onHand: 5, requested: 5 })).toEqual({ ok: true });
        expect(avail.check({ mode: 'SERIAL', onHand: 2, requested: 2 })).toEqual({ ok: true });
    });
});

describe('shortfall - default PREVENT (D-48)', () => {
    test('plain short defers (never FAILED first attempt, #19)', () => {
        expect(avail.check({ mode: 'PLAIN', onHand: 3, requested: 5 })).toEqual({ ok: false, action: 'DEFER', reasonCode: 'INSUFFICIENT_AVAILABILITY' });
    });
    test('lot short defers', () => {
        expect(avail.check({ mode: 'LOT', onHand: 0, requested: 1 }).action).toBe('DEFER');
    });
});

describe('per-location allowNegative (D-48) applies to PLAIN/LOT only', () => {
    test('plain posts negative when the location allows it', () => {
        expect(avail.check({ mode: 'PLAIN', onHand: 3, requested: 5, allowNegative: true })).toEqual({ ok: true, wentNegative: true });
    });
    test('SERIAL never goes negative, even with allowNegative (invariant #21)', () => {
        expect(avail.check({ mode: 'SERIAL', onHand: 1, requested: 2, allowNegative: true }))
            .toEqual({ ok: false, action: 'DEFER', reasonCode: 'SERIAL_NOT_AVAILABLE' });
    });
});

describe('errors', () => {
    test('non-positive requested throws', () => {
        expect(grab(() => avail.check({ mode: 'PLAIN', onHand: 1, requested: 0 })).name).toBe('ERR_WMS_INVALID_QUANTITY');
    });
    test('unknown mode throws', () => {
        expect(grab(() => avail.check({ mode: 'X', onHand: 1, requested: 1 })).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
