/**
 * Unit tests for wms_lib_wo_flow (Phase 5B / D-43, D-44, D-45, Q-27). No account.
 */
const wo = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_wo_flow.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('transferScreen (D-45) - default to available', () => {
    test('available = onHand - committed; defaultQty = available', () => {
        expect(wo.transferScreen({ onHand: 100, committed: 30, needed: 40 }))
            .toEqual({ onHand: 100, committed: 30, available: 70, needed: 40, defaultQty: 70 });
    });
    test('available floors at zero when committed exceeds on hand', () => {
        expect(wo.transferScreen({ onHand: 10, committed: 15, needed: 5 }).available).toBe(0);
    });
    test('bad input throws', () => {
        expect(grab(() => wo.transferScreen({ onHand: 'x', committed: 0, needed: 0 })).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('assertProductionTarget (D-44) - a WO builds at one PRODUCTION location', () => {
    test('accepts PRODUCTION, rejects anything else', () => {
        expect(wo.assertProductionTarget({ locationClass: 'PRODUCTION' })).toBe(true);
        expect(grab(() => wo.assertProductionTarget({ locationClass: 'OPERATIONAL' })).name).toBe('ERR_WMS_WO_TARGET_NOT_PRODUCTION');
        expect(grab(() => wo.assertProductionTarget(null)).name).toBe('ERR_WMS_WO_TARGET_NOT_PRODUCTION');
    });
});

describe('overReceiptCheck (Q-27)', () => {
    test('under or equal ordered is fine', () => {
        expect(wo.overReceiptCheck(100, 90, 5)).toEqual({ ok: true });
        expect(wo.overReceiptCheck(100, 100, 5)).toEqual({ ok: true });
    });
    test('within tolerance is fine', () => {
        expect(wo.overReceiptCheck(100, 104, 5)).toEqual({ ok: true });
    });
    test('beyond tolerance needs approval', () => {
        const r = wo.overReceiptCheck(100, 110, 5);
        expect(r.ok).toBe(false);
        expect(r.reasonCode).toBe('OVER_RECEIPT');
        expect(r.overBy).toBe(10);
        expect(r.needsApproval).toBe(true);
    });
});
