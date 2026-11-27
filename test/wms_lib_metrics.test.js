/**
 * Unit tests for wms_lib_metrics (Phase 9 / invariant #10, D-39). No account.
 */
const metrics = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_metrics.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('aggregate', () => {
    const events = [
        { type: 'PICK', order: 'SO1', orderLineKey: 'L1', qty: 3 },
        { type: 'PICK', order: 'SO1', orderLineKey: 'L1', qty: 2 }, // same line -> 1 line, 5 units
        { type: 'PICK', order: 'SO1', orderLineKey: 'L2', qty: 4 },
        { type: 'PACK', order: 'SO1' },
        { type: 'OVERRIDE' },
        { type: 'PICK', order: 'SO2', orderLineKey: 'L1', qty: 1, status: 'FAILED' },
    ];
    test('counts scans, errors, overrides, distinct picked lines, units, packed orders', () => {
        expect(metrics.aggregate(events)).toEqual({
            scansTotal: 6,
            scansError: 1,
            scansOverride: 1,
            linesPicked: 3, // SO1#L1, SO1#L2, SO2#L1
            unitsPicked: 10, // 3+2+4+1
            ordersPacked: 1,
        });
    });
    test('non-array throws', () => {
        expect(grab(() => metrics.aggregate(null)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('snapshotFor', () => {
    test('merges counters with location/operator/interval (operator null = team row)', () => {
        const snap = metrics.snapshotFor([{ type: 'PICK', order: 'A', orderLineKey: '1', qty: 1 }], { location: '7', intervalStart: 't0', intervalEnd: 't1' });
        expect(snap.location).toBe('7');
        expect(snap.operator).toBeNull();
        expect(snap.unitsPicked).toBe(1);
    });
});
