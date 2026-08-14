/**
 * Unit tests for wms_lib_receipt (vertical slice). No NetSuite account.
 *
 * The point of this file: a MIXED-MODE group (a plain line and a lot line on the
 * same source document) must give each line its OWN mode, and the lot line must
 * receive inventory detail. This is the test that stops the "resolve once from
 * first, apply to the group" bug from regressing (invariant #14).
 */
const receipt = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_receipt.js');
const detail = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_inventory_detail.js');

describe('buildReceiptLines - mode is per line, not per group', () => {
    test('a plain line and a lot line on one document each get their own mode', () => {
        const events = [
            { eventId: 'e1', item: 'P', quantity: 2 },
            { eventId: 'e2', item: 'L', quantity: 5, lot: 'B1' },
        ];
        const seen = [];
        const resolveMode = (itemId) => {
            seen.push(itemId);
            return itemId === 'L' ? 'LOT' : 'PLAIN';
        };

        const lines = receipt.buildReceiptLines(events, resolveMode);

        // each line carries its own mode - the regression guard
        expect(lines[0]).toMatchObject({ eventId: 'e1', item: 'P', quantity: 2, mode: 'PLAIN' });
        expect(lines[1]).toMatchObject({ eventId: 'e2', item: 'L', quantity: 5, mode: 'LOT', lot: 'B1' });

        // resolveMode was called PER ITEM (not once for the group)
        expect(seen).toEqual(['P', 'L']);

        // ...and the lot line receives inventory detail while the plain line does not
        expect(detail.buildInventoryAssignments(lines[0])).toEqual([]);
        expect(detail.buildInventoryAssignments(lines[1])).toEqual([
            { receiptinventorynumber: 'B1', quantity: 5 },
        ]);
    });

    test('a serial line in a mixed group gets one detail line per serial, quantity 1', () => {
        const events = [
            { eventId: 'e1', item: 'P', quantity: 1 },
            { eventId: 'e2', item: 'S', quantity: 2, serials: ['SN-1', 'SN-2'] },
        ];
        const resolveMode = (id) => (id === 'S' ? 'SERIAL' : 'PLAIN');
        const lines = receipt.buildReceiptLines(events, resolveMode);
        expect(lines[1].mode).toBe('SERIAL');
        expect(detail.buildInventoryAssignments(lines[1])).toEqual([
            { receiptinventorynumber: 'SN-1', quantity: 1 },
            { receiptinventorynumber: 'SN-2', quantity: 1 },
        ]);
    });

    test('programmer errors: bad events / bad resolver', () => {
        expect(() => receipt.buildReceiptLines('nope', () => 'PLAIN')).toThrow(/events must be an array/);
        expect(() => receipt.buildReceiptLines([], 'nope')).toThrow(/resolveMode must be a function/);
    });
});
