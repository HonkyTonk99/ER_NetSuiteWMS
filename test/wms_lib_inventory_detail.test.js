/**
 * Unit tests for wms_lib_inventory_detail (vertical slice). No NetSuite account.
 * The serial shape (one line per serial, quantity 1) is the thing Day 7 exists to
 * prove in-account; these tests pin the pure shaping so a regression is caught here.
 */
const detail = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_inventory_detail.js');

describe('buildInventoryAssignments', () => {
    test('PLAIN -> no inventory detail (PF-16)', () => {
        expect(detail.buildInventoryAssignments({ mode: 'PLAIN', quantity: 5 })).toEqual([]);
    });

    test('LOT -> one line, quantity may exceed 1 (PF-17), receiptinventorynumber on receipt', () => {
        expect(detail.buildInventoryAssignments({ mode: 'LOT', quantity: 12, lot: 'BATCH-001' })).toEqual([
            { receiptinventorynumber: 'BATCH-001', quantity: 12 },
        ]);
    });

    test('SERIAL -> one line PER serial, quantity EXACTLY 1 (PF-17)', () => {
        expect(
            detail.buildInventoryAssignments({ mode: 'SERIAL', quantity: 2, serials: ['SN-1', 'SN-2'] })
        ).toEqual([
            { receiptinventorynumber: 'SN-1', quantity: 1 },
            { receiptinventorynumber: 'SN-2', quantity: 1 },
        ]);
    });

    test('issue direction uses issueinventorynumber', () => {
        expect(detail.buildInventoryAssignments({ mode: 'LOT', quantity: 3, lot: 'L' }, 'issue')).toEqual([
            { issueinventorynumber: 'L', quantity: 3 },
        ]);
    });

    test('serial count != quantity throws ERR_WMS_SERIAL_COUNT_MISMATCH (never pads/truncates)', () => {
        expect.assertions(2);
        try {
            detail.buildInventoryAssignments({ mode: 'SERIAL', quantity: 3, serials: ['SN-1', 'SN-2'] });
        } catch (e) {
            expect(e.name).toBe('ERR_WMS_SERIAL_COUNT_MISMATCH');
            expect(e.message).toMatch(/2.*3/);
        }
    });

    test('programmer errors: missing lot, non-positive qty, unknown mode, bad direction', () => {
        expect(() => detail.buildInventoryAssignments({ mode: 'LOT', quantity: 1 })).toThrow(/lot/);
        expect(() => detail.buildInventoryAssignments({ mode: 'PLAIN', quantity: 0 })).toThrow(/positive/);
        expect(() => detail.buildInventoryAssignments({ mode: 'NOPE', quantity: 1 })).toThrow(/tracking mode/);
        expect(() => detail.buildInventoryAssignments({ mode: 'PLAIN', quantity: 1 }, 'sideways')).toThrow(/receipt.*issue/);
    });

    test('missing lot and bad-value errors carry ERR_WMS_* names', () => {
        try {
            detail.buildInventoryAssignments({ mode: 'LOT', quantity: 1 });
        } catch (e) {
            expect(e.name).toBe('ERR_WMS_MISSING_LOT');
        }
    });
});
