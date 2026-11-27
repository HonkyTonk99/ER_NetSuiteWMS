/**
 * Unit tests for wms_lib_putaway (Phase 5B / D-09, D-16, AD-14, #20). No account.
 */
const putaway = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_putaway.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

const P = { singleSku: true, singleBatch: true, allowPutaway: true };

describe('selectTarget - good stock to OPERATIONAL', () => {
    test('prefers the emptiest fitting bin', () => {
        const c = [
            { bin: 'U1', locationClass: 'OPERATIONAL', policy: P, item: 'X', lot: 'L1', qty: 3, capacity: 10 },
            { bin: 'U2', locationClass: 'OPERATIONAL', policy: P, item: '', qty: 0, capacity: 10 },
        ];
        expect(putaway.selectTarget({ item: 'X', lot: 'L1', qty: 5 }, c)).toEqual({ ok: true, target: 'U2' });
    });
    test('single-SKU conflict excludes an occupied bin holding another item (#20 policy)', () => {
        const c = [{ bin: 'U1', locationClass: 'OPERATIONAL', policy: P, item: 'Y', lot: 'L1', qty: 1, capacity: 10 }];
        expect(putaway.selectTarget({ item: 'X', lot: 'L1', qty: 1 }, c)).toEqual({ ok: false, reasonCode: 'NO_PUTAWAY_LOCATION' });
    });
    test('single-batch conflict excludes a different lot', () => {
        const c = [{ bin: 'U1', locationClass: 'OPERATIONAL', policy: P, item: 'X', lot: 'L1', qty: 1, capacity: 10 }];
        expect(putaway.selectTarget({ item: 'X', lot: 'L2', qty: 1 }, c).ok).toBe(false);
    });
    test('capacity overflow excludes a bin', () => {
        const c = [{ bin: 'U1', locationClass: 'OPERATIONAL', policy: P, item: 'X', lot: 'L1', qty: 8, capacity: 10 }];
        expect(putaway.selectTarget({ item: 'X', lot: 'L1', qty: 5 }, c).ok).toBe(false);
    });
    test('allowPutaway=false and inactive/blocked excluded', () => {
        const c = [
            { bin: 'A', locationClass: 'OPERATIONAL', policy: { allowPutaway: false }, item: '', qty: 0 },
            { bin: 'B', locationClass: 'OPERATIONAL', policy: P, item: '', qty: 0, active: false },
            { bin: 'C', locationClass: 'OPERATIONAL', policy: P, item: '', qty: 0, blocked: true },
        ];
        expect(putaway.selectTarget({ item: 'X', lot: 'L1', qty: 1 }, c).ok).toBe(false);
    });
});

describe('selectTarget - quarantine receipt to HOLDING', () => {
    test('holding receipt only targets HOLDING-class bins', () => {
        const c = [
            { bin: 'U1', locationClass: 'OPERATIONAL', policy: P, item: '', qty: 0 },
            { bin: 'Q1', locationClass: 'HOLDING', policy: P, item: '', qty: 0 },
        ];
        expect(putaway.selectTarget({ item: 'X', lot: 'L1', qty: 1, holding: true }, c)).toEqual({ ok: true, target: 'Q1' });
    });
});

describe('errors', () => {
    test('non-positive qty throws', () => {
        expect(grab(() => putaway.selectTarget({ item: 'X', qty: 0 }, [])).name).toBe('ERR_WMS_INVALID_QUANTITY');
    });
});
