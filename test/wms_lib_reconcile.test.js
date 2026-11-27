/**
 * Unit tests for wms_lib_reconcile (Phase 8 / T-8.3, #22, #20). No account.
 */
const rec = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_reconcile.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('serialConsistency (#22)', () => {
    test('bin qty must equal serial-row count', () => {
        expect(rec.serialConsistency(3, 3).ok).toBe(true);
        expect(rec.serialConsistency(3, 2).ok).toBe(false);
    });
});

describe('stockDrift (#1 - WMS vs NetSuite on hand)', () => {
    test('equal within epsilon is ok; fractional residue tolerated (#20)', () => {
        expect(rec.stockDrift(10, 10).ok).toBe(true);
        expect(rec.stockDrift(10.0000001, 10).ok).toBe(true);
        expect(rec.stockDrift(12, 10)).toEqual({ ok: false, drift: 2 });
    });
    test('bad input throws', () => {
        expect(grab(() => rec.stockDrift('x', 1)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('reconcileBatch - surfaces only divergences', () => {
    test('reports stock drift and serial mismatch', () => {
        const drifts = rec.reconcileBatch([
            { item: 'A', location: '1', wmsQty: 10, nsOnHand: 10 }, // clean
            { item: 'B', location: '1', wmsQty: 8, nsOnHand: 5 }, // drift +3
            { item: 'C', location: '1', mode: 'SERIAL', wmsQty: 4, nsOnHand: 4, binQty: 4, serialRowCount: 3 }, // serial mismatch
        ]);
        expect(drifts).toHaveLength(2);
        expect(drifts.find((d) => d.item === 'B')).toMatchObject({ reasonCode: 'RECONCILIATION_DRIFT', drift: 3 });
        expect(drifts.find((d) => d.item === 'C')).toMatchObject({ reasonCode: 'SERIAL_COUNT_MISMATCH', serialRowCount: 3 });
    });
    test('non-array throws', () => {
        expect(grab(() => rec.reconcileBatch(null)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
