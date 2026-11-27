/**
 * Unit tests for wms_lib_qms (Phase 9Q / D-54). No account.
 */
const qms = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_qms.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('inspectionRequest - stage a QMS queue entry', () => {
    test('maps a receipt line to the request payload', () => {
        const r = qms.inspectionRequest({ item: 'X', lot: 'L1', qty: 10, location: '1', sourceDoc: 'PO9', serials: ['a', 'b'] }, 'SPEC1');
        expect(r).toEqual({ spec: 'SPEC1', item: 'X', lot: 'L1', qty: 10, location: '1', sourceDoc: 'PO9', serials: ['a', 'b'] });
    });
    test('missing event or spec throws', () => {
        expect(grab(() => qms.inspectionRequest(null, 'S')).name).toBe('ERR_WMS_INVALID_ARGUMENT');
        expect(grab(() => qms.inspectionRequest({ item: 'X' })).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('onResult - WMS owns the movement (D-54), not QMS', () => {
    test('PASS releases via Inventory Transfer holding -> operational', () => {
        expect(qms.onResult({ outcome: 'PASS' })).toEqual({ action: 'RELEASE', wmsMovement: 'INVENTORY_TRANSFER', from: 'HOLDING', to: 'OPERATIONAL' });
    });
    test('FAIL quarantines (stays in holding; write-off is separate, D-33)', () => {
        const r = qms.onResult({ outcome: 'FAIL' });
        expect(r.action).toBe('QUARANTINE');
        expect(r.wmsMovement).toBeNull();
    });
    test('PARTIAL splits release vs quarantine by qty', () => {
        const r = qms.onResult({ outcome: 'PARTIAL', passQty: 7, failQty: 3 });
        expect(r.action).toBe('SPLIT');
        expect(r.release.qty).toBe(7);
        expect(r.quarantine.qty).toBe(3);
    });
    test('unknown outcome throws', () => {
        expect(grab(() => qms.onResult({ outcome: 'MAYBE' })).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
