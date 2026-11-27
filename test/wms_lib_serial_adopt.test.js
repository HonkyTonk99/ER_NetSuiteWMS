/**
 * Unit tests for wms_lib_serial_adopt (Phase 13 / D-58, Q-54). No account.
 */
const adopt = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_serial_adopt.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('adoptDecision', () => {
    test('WMS already has the row -> no action', () => {
        expect(adopt.adoptDecision({ wmsRow: { id: 1 }, existsInNetSuite: true })).toEqual({ action: 'NO_ACTION' });
    });
    test('not in NetSuite either -> reject SERIAL_UNKNOWN', () => {
        expect(adopt.adoptDecision({ wmsRow: null, existsInNetSuite: false })).toEqual({ action: 'REJECT', reasonCode: 'SERIAL_UNKNOWN' });
    });
    test('adoptable but unauthorised -> requires supervisor', () => {
        expect(adopt.adoptDecision({ wmsRow: null, existsInNetSuite: true, authorised: false })).toEqual({ action: 'REQUIRES_AUTH' });
    });
    test('authorised adopt creates a fresh IN_STOCK row at generation 0 (no on-the-fly during pick)', () => {
        const r = adopt.adoptDecision({ wmsRow: null, existsInNetSuite: true, authorised: true, item: 'X', serial: 'SN1', bin: 'B1', location: '1' });
        expect(r.action).toBe('ADOPT');
        expect(r.row).toEqual({ item: 'X', serial: 'SN1', bin: 'B1', location: '1', status: 'IN_STOCK', generation: 0 });
    });
    test('bad input throws', () => {
        expect(grab(() => adopt.adoptDecision(null)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
