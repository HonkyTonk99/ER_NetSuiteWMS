/**
 * Unit tests for wms_lib_serial (Phase 5B / D-29, §3.13b, #21/#22). No account.
 */
const serial = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_serial.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('validateEntry (receiving)', () => {
    test('new serial accepted', () => {
        expect(serial.validateEntry('SN1', null)).toEqual({ ok: true, reactivate: false, nextGeneration: 0 });
    });
    test('active serial rejected (STOP, SERIAL_ALREADY_LIVE)', () => {
        expect(serial.validateEntry('SN1', { status: 'IN_STOCK' })).toEqual({ ok: false, action: 'STOP', reasonCode: 'SERIAL_ALREADY_LIVE' });
    });
    test('retired serial reactivates same row, generation++ (PF-23, no second row)', () => {
        expect(serial.validateEntry('SN1', { status: 'RETIRED', generation: 2 })).toEqual({ ok: true, reactivate: true, nextGeneration: 3 });
    });
    test('missing serial throws', () => {
        expect(grab(() => serial.validateEntry('', null)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('validatePick (data-wrong vs action-wrong, §3.13b)', () => {
    test('unknown serial STOPs (never created on the fly; adopt path Q-54)', () => {
        expect(serial.validatePick('SN1', null, {})).toEqual({ ok: false, action: 'STOP', reasonCode: 'SERIAL_UNKNOWN' });
    });
    test('wrong item STOPs', () => {
        expect(serial.validatePick('SN1', { item: 'A', status: 'IN_STOCK', bin: 'B1' }, { expectedItem: 'B' }).reasonCode).toBe('SERIAL_WRONG_ITEM');
    });
    test('not-available STOPs with the sub-case named', () => {
        const r = serial.validatePick('SN1', { item: 'A', status: 'SHIPPED', bin: 'B1' }, { expectedItem: 'A' });
        expect(r).toMatchObject({ ok: false, action: 'STOP', reasonCode: 'SERIAL_NOT_AVAILABLE', subCase: 'SHIPPED' });
    });
    test('wrong bin CONTINUEs (physical world wins), raises a discrepancy', () => {
        const r = serial.validatePick('SN1', { item: 'A', status: 'IN_STOCK', bin: 'B9' }, { expectedItem: 'A', expectedBin: 'B1' });
        expect(r).toEqual({ ok: true, action: 'CONTINUE', discrepancy: 'SERIAL_WRONG_BIN', actualBin: 'B9' });
    });
    test('correct serial in the right bin is clean', () => {
        expect(serial.validatePick('SN1', { item: 'A', status: 'IN_STOCK', bin: 'B1' }, { expectedItem: 'A', expectedBin: 'B1' })).toEqual({ ok: true });
    });
});

describe('countMatches', () => {
    test('length must equal quantity', () => {
        expect(serial.countMatches(['a', 'b'], 2)).toEqual({ ok: true });
        expect(serial.countMatches(['a'], 2).reasonCode).toBe('SERIAL_COUNT_MISMATCH');
    });
    test('duplicate serials in one line rejected', () => {
        expect(serial.countMatches(['a', 'a'], 2).reasonCode).toBe('SERIAL_COUNT_MISMATCH');
    });
    test('non-array throws', () => {
        expect(grab(() => serial.countMatches('a', 1)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
