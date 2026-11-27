/**
 * Unit tests for wms_lib_pickpath (Phase 6 / D-55). No account.
 */
const pp = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_pickpath.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('orderTasks', () => {
    test('orders by zone walk order, then pick sequence, then bin', () => {
        const tasks = [
            { bin: 'B', zone: 'Z2', pickSequence: 1 },
            { bin: 'A', zone: 'Z1', pickSequence: 5 },
            { bin: 'C', zone: 'Z1', pickSequence: 2 },
        ];
        const zoneOrder = { Z1: 0, Z2: 1 };
        expect(pp.orderTasks(tasks, zoneOrder).map((t) => t.bin)).toEqual(['C', 'A', 'B']);
    });
    test('without zone order, orders by pick sequence then bin', () => {
        const tasks = [
            { bin: 'X', pickSequence: 10 },
            { bin: 'Y', pickSequence: 2 },
            { bin: 'Z', pickSequence: 2 },
        ];
        expect(pp.orderTasks(tasks).map((t) => t.bin)).toEqual(['Y', 'Z', 'X']);
    });
    test('unsequenced / unzoned sort last', () => {
        const tasks = [{ bin: 'U' }, { bin: 'S', pickSequence: 1 }];
        expect(pp.orderTasks(tasks).map((t) => t.bin)).toEqual(['S', 'U']);
    });
    test('does not mutate input', () => {
        const tasks = [{ bin: 'B', pickSequence: 2 }, { bin: 'A', pickSequence: 1 }];
        const before = JSON.stringify(tasks);
        pp.orderTasks(tasks);
        expect(JSON.stringify(tasks)).toBe(before);
    });
    test('non-array throws', () => {
        expect(grab(() => pp.orderTasks(null)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
