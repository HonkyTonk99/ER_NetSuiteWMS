/**
 * Unit tests for wms_lib_config (Phase 2 / invariant #9, D-14 per-location override).
 * No NetSuite account.
 */
const config = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_config.js');

const ROWS = [
    { key: 'ingest_batch_size', value: '50', location: '' },
    { key: 'ingest_batch_size', value: '25', location: '7' },
    { key: 'allow_negative', value: 'F', location: '' },
    { key: 'allow_negative', value: 'T', location: '7' },
    { key: 'short_pick_policy', value: 'HOLD', location: '' },
];

describe('select - per-location override beats global (D-14)', () => {
    test('scoped row wins for its location', () => {
        expect(config.select(ROWS, 'ingest_batch_size', '7')).toBe('25');
    });
    test('falls back to global when no scoped row for that location', () => {
        expect(config.select(ROWS, 'ingest_batch_size', '9')).toBe('50');
        expect(config.select(ROWS, 'ingest_batch_size', null)).toBe('50');
    });
    test('absent key is undefined', () => {
        expect(config.select(ROWS, 'nope', '7')).toBeUndefined();
    });
});

describe('typed getters with explicit defaults', () => {
    test('getNumber', () => {
        expect(config.getNumber(ROWS, 'ingest_batch_size', '7', 10)).toBe(25);
        expect(config.getNumber(ROWS, 'ingest_batch_size', '9', 10)).toBe(50);
        expect(config.getNumber(ROWS, 'missing', '7', 10)).toBe(10);
    });
    test('getBoolean (allow_negative, D-48: default prevent at global, allowed at loc 7)', () => {
        expect(config.getBoolean(ROWS, 'allow_negative', '7', false)).toBe(true);
        expect(config.getBoolean(ROWS, 'allow_negative', '9', false)).toBe(false);
        expect(config.getBoolean(ROWS, 'missing', '7', false)).toBe(false);
    });
    test('getString', () => {
        expect(config.getString(ROWS, 'short_pick_policy', null, 'SHIP_PARTIAL')).toBe('HOLD');
        expect(config.getString(ROWS, 'missing', null, 'SHIP_PARTIAL')).toBe('SHIP_PARTIAL');
    });
});

describe('errors (D-23: ERR_WMS_* on .name)', () => {
    const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

    test('non-array rows', () => {
        expect(grab(() => config.select(null, 'k', '7')).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
    test('missing key', () => {
        expect(grab(() => config.select(ROWS, '', '7')).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
    test('non-numeric where a number is expected', () => {
        const rows = [{ key: 'x', value: 'abc', location: '' }];
        expect(grab(() => config.getNumber(rows, 'x', null, 0)).name).toBe('ERR_WMS_INVALID_CONFIG_VALUE');
    });
    test('non-boolean where a boolean is expected', () => {
        const rows = [{ key: 'x', value: 'maybe', location: '' }];
        expect(grab(() => config.getBoolean(rows, 'x', null, false)).name).toBe('ERR_WMS_INVALID_CONFIG_VALUE');
    });
});
