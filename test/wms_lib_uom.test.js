/**
 * Unit tests for wms_lib_uom (Phase 2 / D-46). No NetSuite account.
 */
const uom = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_uom.js');

const UNITS = { baseUom: 'EA', ratios: { EA: 1, CASE: 12, PALLET: 144 } };

describe('convert', () => {
    test('up and down the ladder', () => {
        expect(uom.convert(1, 'CASE', 'EA', UNITS)).toBe(12);
        expect(uom.convert(24, 'EA', 'CASE', UNITS)).toBe(2);
        expect(uom.convert(1, 'PALLET', 'CASE', UNITS)).toBe(12);
    });
    test('same uom is a validated pass-through', () => {
        expect(uom.convert(5, 'EA', 'EA', UNITS)).toBe(5);
    });
    test('fractional result is preserved (Decimal; no forced rounding, invariant #20)', () => {
        expect(uom.convert(1, 'EA', 'CASE', UNITS)).toBeCloseTo(1 / 12, 10);
    });
});

describe('toBase / fromBase', () => {
    test('round-trips', () => {
        expect(uom.toBase(2, 'CASE', UNITS)).toBe(24);
        expect(uom.fromBase(24, 'CASE', UNITS)).toBe(2);
    });
});

describe('isWholeInBase', () => {
    test('true when the quantity is a whole number of base units', () => {
        expect(uom.isWholeInBase(0.5, 'CASE', UNITS)).toBe(true); // 0.5*12 = 6
        expect(uom.isWholeInBase(1, 'EA', UNITS)).toBe(true);
    });
    test('false when it leaves a partial base unit', () => {
        expect(uom.isWholeInBase(1, 'EA', { baseUom: 'EA', ratios: { EA: 1, HALF: 0.5 } })).toBe(true);
        expect(uom.isWholeInBase(1, 'HALF', { baseUom: 'EA', ratios: { EA: 1, HALF: 0.5 } })).toBe(false);
    });
});

describe('errors (D-23: ERR_WMS_* on .name, human-readable message)', () => {
    const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

    test('unknown uom', () => {
        const e = grab(() => uom.convert(1, 'DRUM', 'EA', UNITS));
        expect(e.name).toBe('ERR_WMS_UNKNOWN_UOM');
        expect(e.message).toContain('DRUM');
    });
    test('non-positive quantity', () => {
        expect(grab(() => uom.convert(0, 'CASE', 'EA', UNITS)).name).toBe('ERR_WMS_INVALID_QUANTITY');
        expect(grab(() => uom.toBase(-3, 'EA', UNITS)).name).toBe('ERR_WMS_INVALID_QUANTITY');
    });
    test('bad units table', () => {
        expect(grab(() => uom.convert(1, 'EA', 'EA', null)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
        expect(grab(() => uom.convert(1, 'EA', 'EA', { baseUom: 'EA' })).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
    test('non-positive ratio in the table', () => {
        expect(grab(() => uom.toBase(1, 'BAD', { baseUom: 'EA', ratios: { EA: 1, BAD: 0 } })).name)
            .toBe('ERR_WMS_INVALID_UOM_RATIO');
    });
});
