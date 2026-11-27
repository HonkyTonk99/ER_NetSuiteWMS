/**
 * Unit tests for wms_lib_replenishment (Phase 5 / invariant #23, FEFO). No account.
 */
const replen = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_replenishment.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('selectSources - FEFO + #23 holding guard', () => {
    const candidates = [
        { bin: 'B1', location: '1', locationClass: 'OPERATIONAL', lot: 'L2', expiry: '2026-03-01', qty: 4 },
        { bin: 'B2', location: '1', locationClass: 'OPERATIONAL', lot: 'L1', expiry: '2026-01-01', qty: 5 },
        { bin: 'H1', location: '2', locationClass: 'HOLDING', lot: 'L0', expiry: '2025-01-01', qty: 100 },
    ];
    test('earliest expiry first; holding location NEVER sourced (#23) despite earliest expiry', () => {
        const r = replen.selectSources({ item: 'X', qtyNeeded: 10 }, candidates);
        expect(r.sources.map((s) => s.bin)).toEqual(['B2', 'B1']); // H1 excluded
        expect(r.allocated).toBe(9);
        expect(r.shortfall).toBe(1);
    });
    test('no-expiry stock sorts last (FIFO fallback, D-03)', () => {
        const c = [
            { bin: 'N', location: '1', locationClass: 'OPERATIONAL', qty: 5 },
            { bin: 'E', location: '1', locationClass: 'OPERATIONAL', expiry: '2026-01-01', qty: 5 },
        ];
        const r = replen.selectSources({ item: 'X', qtyNeeded: 3 }, c);
        expect(r.sources[0].bin).toBe('E');
    });
    test('blocked and zero-qty candidates are skipped', () => {
        const c = [
            { bin: 'Z', location: '1', locationClass: 'OPERATIONAL', qty: 0 },
            { bin: 'Y', location: '1', locationClass: 'OPERATIONAL', qty: 5, blocked: true },
            { bin: 'G', location: '1', locationClass: 'OPERATIONAL', qty: 5 },
        ];
        expect(replen.selectSources({ item: 'X', qtyNeeded: 2 }, c).sources.map((s) => s.bin)).toEqual(['G']);
    });
});

describe('assertOperationalSource - #23 absolute', () => {
    test('refuses a mandated holding/production source outright', () => {
        expect(grab(() => replen.assertOperationalSource({ locationClass: 'HOLDING' })).name).toBe('ERR_WMS_HOLDING_SOURCE_FORBIDDEN');
        expect(grab(() => replen.assertOperationalSource({ locationClass: 'PRODUCTION' })).name).toBe('ERR_WMS_HOLDING_SOURCE_FORBIDDEN');
        expect(replen.assertOperationalSource({ locationClass: 'OPERATIONAL' })).toBe(true);
    });
});

describe('errors', () => {
    test('non-positive qtyNeeded throws', () => {
        expect(grab(() => replen.selectSources({ item: 'X', qtyNeeded: 0 }, [])).name).toBe('ERR_WMS_INVALID_QUANTITY');
    });
});
