/**
 * Unit tests for wms_lib_item_mode (PF-14a). No NetSuite account.
 * Only the PURE switch (modeForRecordType) is exercised - the N/search lookup is
 * a thin wrapper, deliberately separated so the mapping is testable on its own.
 */
const itemMode = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_item_mode.js');

describe('modeForRecordType - all six record types map correctly', () => {
    const cases = [
        ['inventoryitem', 'PLAIN'],
        ['assemblyitem', 'PLAIN'],
        ['lotnumberedinventoryitem', 'LOT'],
        ['lotnumberedassemblyitem', 'LOT'],
        ['serializedinventoryitem', 'SERIAL'],
        ['serializedassemblyitem', 'SERIAL'],
    ];
    test.each(cases)('%s -> %s', (recordType, expected) => {
        expect(itemMode.modeForRecordType(recordType, '42')).toBe(expected);
    });

    test('serialised maps to SERIAL, not a plain-ish value that would route serial down the plain path', () => {
        expect(itemMode.modeForRecordType('serializedinventoryitem', '1')).toBe('SERIAL');
        expect(itemMode.modeForRecordType('serializedinventoryitem', '1')).not.toBe('PLAIN');
    });
});

describe('modeForRecordType - unknown type throws, never defaults', () => {
    test('an unrecognised record type throws ERR_WMS_UNKNOWN_ITEM_TYPE with id + observed type', () => {
        expect.assertions(3);
        try {
            itemMode.modeForRecordType('noninventoryitem', '99');
        } catch (e) {
            expect(e.name).toBe('ERR_WMS_UNKNOWN_ITEM_TYPE');
            expect(e.message).toContain('99');
            expect(e.message).toContain('noninventoryitem');
        }
    });

    test('it does NOT silently return PLAIN for an unknown type (silent corruption guard)', () => {
        expect(() => itemMode.modeForRecordType('kititem', '7')).toThrow(/ERR_WMS_UNKNOWN_ITEM_TYPE|unrecognised/);
    });
});
