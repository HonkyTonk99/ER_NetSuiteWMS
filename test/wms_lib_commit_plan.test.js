/**
 * Unit tests for wms_lib_commit_plan (Phase 4 / invariants #18, #4). No account.
 */
const plan = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_commit_plan.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('plan - two-phase, inbound before outbound (#18)', () => {
    test('partitions receipts, fulfilments and movements', () => {
        const out = plan.plan([
            { eventType: 'RECEIPT_PO', uuid: 'r1' },
            { eventType: 'PICK', uuid: 'p1', order: 'SO1', location: '1' },
            { eventType: 'BIN_TRANSFER', uuid: 'm1', sourceLocation: '1', targetLocation: '1' },
            { eventType: 'BIN_TRANSFER', uuid: 'm2', sourceLocation: '1', targetLocation: '2' },
        ]);
        expect(out.phaseA.map((e) => e.uuid)).toEqual(['r1']);
        expect(out.phaseB.map((e) => e.uuid).sort()).toEqual(['m2', 'p1']); // cross-loc transfer + pick
        expect(out.binOnly.map((e) => e.uuid)).toEqual(['m1']); // same-location move posts nothing
    });
    test('crossLocation flag is honoured directly', () => {
        const out = plan.plan([{ eventType: 'REPLEN_MOVE', uuid: 'x', crossLocation: true }]);
        expect(out.phaseB.map((e) => e.uuid)).toEqual(['x']);
    });
    test('non-array / missing eventType throw', () => {
        expect(grab(() => plan.plan(null)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
        expect(grab(() => plan.plan([{}])).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('groupFulfilment - one transform per (order, location) (#4)', () => {
    test('groups picks by order+location; others post solo', () => {
        const groups = plan.groupFulfilment([
            { eventType: 'PICK', order: 'SO1', location: '1', uuid: 'a' },
            { eventType: 'PICK', order: 'SO1', location: '1', uuid: 'b' },
            { eventType: 'PICK', order: 'SO1', location: '2', uuid: 'c' },
            { eventType: 'WRITE_OFF', uuid: 'd' },
        ]);
        expect(groups).toHaveLength(3);
        const twoEvent = groups.find((g) => g.events.length === 2);
        expect(twoEvent.events.map((e) => e.uuid)).toEqual(['a', 'b']);
        expect(groups.some((g) => g.events.length === 1 && g.events[0].uuid === 'c')).toBe(true);
        expect(groups.some((g) => g.events[0].uuid === 'd')).toBe(true);
    });
});

describe('shouldEscalate - deferral timeout', () => {
    test('escalates at/over the limit', () => {
        expect(plan.shouldEscalate(3, 3)).toBe(true);
        expect(plan.shouldEscalate(4, 3)).toBe(true);
        expect(plan.shouldEscalate(2, 3)).toBe(false);
    });
    test('non-numeric throws', () => {
        expect(grab(() => plan.shouldEscalate('x', 3)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
