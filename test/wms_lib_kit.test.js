/**
 * Unit tests for wms_lib_kit (Phase 7 / D-36). No account.
 */
const kit = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_kit.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('expandKit', () => {
    test('multiplies component per-kit by kit quantity', () => {
        const tasks = kit.expandKit('K1', [{ item: 'A', perKit: 2 }, { item: 'B', perKit: 1 }], 3);
        expect(tasks).toEqual([
            { kitId: 'K1', item: 'A', qty: 6 },
            { kitId: 'K1', item: 'B', qty: 3 },
        ]);
    });
    test('bad quantities throw', () => {
        expect(grab(() => kit.expandKit('K1', [{ item: 'A', perKit: 1 }], 0)).name).toBe('ERR_WMS_INVALID_QUANTITY');
        expect(grab(() => kit.expandKit('K1', [{ item: 'A', perKit: 0 }], 1)).name).toBe('ERR_WMS_INVALID_QUANTITY');
        expect(grab(() => kit.expandKit('K1', [], 1)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('completeness - all-or-nothing (D-36, no half-picked kit)', () => {
    const required = [{ item: 'A', qty: 6 }, { item: 'B', qty: 3 }];
    test('complete when every component is fully picked', () => {
        expect(kit.completeness(required, [{ item: 'A', qty: 6 }, { item: 'B', qty: 3 }])).toEqual({ complete: true, missing: [] });
    });
    test('incomplete lists the shortfall per component', () => {
        const r = kit.completeness(required, [{ item: 'A', qty: 6 }, { item: 'B', qty: 1 }]);
        expect(r.complete).toBe(false);
        expect(r.missing).toEqual([{ item: 'B', shortBy: 2 }]);
    });
    test('aggregates multiple picks of the same component', () => {
        expect(kit.completeness(required, [{ item: 'A', qty: 4 }, { item: 'A', qty: 2 }, { item: 'B', qty: 3 }]).complete).toBe(true);
    });
});
