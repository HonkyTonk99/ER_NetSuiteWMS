/**
 * Unit tests for wms_lib_migration (Phase 10 / D-17, T-0.4). No account.
 */
const mig = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_migration.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('validateBinImport', () => {
    test('clean single-SKU/single-batch bins pass', () => {
        const r = mig.validateBinImport([
            { sourceBin: 's1', locationCode: 'WH1', binCode: 'A-01', item: 'X', lot: 'L1' },
            { sourceBin: 's2', locationCode: 'WH1', binCode: 'A-02', item: 'Y', lot: 'L1' },
        ]);
        expect(r).toEqual({ ok: true, violations: [] });
    });
    test('two source bins collapsing to one prefixed name is a COLLISION (fail, not overwrite)', () => {
        const r = mig.validateBinImport([
            { sourceBin: 's1', locationCode: 'WH1', binCode: 'A-01', item: 'X', lot: 'L1' },
            { sourceBin: 's2', locationCode: 'WH1', binCode: 'A-01', item: 'X', lot: 'L1' },
        ]);
        expect(r.ok).toBe(false);
        expect(r.violations[0]).toMatchObject({ reasonCode: 'COLLISION', name: 'WH1-A-01' });
    });
    test('a mixed bin (two distinct item/lot) is a MIXED_BIN blocker', () => {
        const r = mig.validateBinImport([
            { sourceBin: 's1', locationCode: 'WH1', binCode: 'A-01', item: 'X', lot: 'L1' },
            { sourceBin: 's1', locationCode: 'WH1', binCode: 'A-01', item: 'X', lot: 'L2' },
        ]);
        expect(r.ok).toBe(false);
        expect(r.violations.some((v) => v.reasonCode === 'MIXED_BIN')).toBe(true);
    });
    test('non-array throws', () => {
        expect(grab(() => mig.validateBinImport(null)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
