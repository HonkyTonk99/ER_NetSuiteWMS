/**
 * Unit tests for wms_lib_offline_queue (Phase 3 / invariant #11). No account/device.
 */
const q = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_offline_queue.js');

const deps = (() => {
    let n = 0;
    return { uuidFn: () => `u-${++n}`, nowFn: () => 1000 + n };
})();
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('createEvent', () => {
    test('mints uuid + clientTs, status QUEUED, retry 0', () => {
        const e = q.createEvent({ eventType: 'PICK', qty: 2 }, deps);
        expect(e.status).toBe('QUEUED');
        expect(e.retry).toBe(0);
        expect(e.uuid).toMatch(/^u-/);
        expect(e.clientTs).toBeGreaterThan(1000);
        expect(e.eventType).toBe('PICK');
    });
    test('requires uuidFn and nowFn', () => {
        expect(grab(() => q.createEvent({}, {})).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('enqueue / pending', () => {
    test('appends and lists QUEUED', () => {
        let queue = [];
        queue = q.enqueue(queue, q.createEvent({ eventType: 'PICK' }, deps));
        queue = q.enqueue(queue, q.createEvent({ eventType: 'PACK' }, deps));
        expect(q.pending(queue)).toHaveLength(2);
    });
    test('duplicate uuid is idempotent (never queued twice, #3)', () => {
        const e = q.createEvent({ eventType: 'PICK' }, deps);
        let queue = q.enqueue([], e);
        queue = q.enqueue(queue, e);
        expect(queue).toHaveLength(1);
    });
});

describe('takeBatch', () => {
    test('returns the next N pending, in order, bounded', () => {
        let queue = [];
        for (let i = 0; i < 5; i += 1) queue = q.enqueue(queue, q.createEvent({ eventType: 'PICK' }, deps));
        expect(q.takeBatch(queue, 2)).toHaveLength(2);
        expect(q.takeBatch(queue, 50)).toHaveLength(5);
    });
    test('non-positive size throws', () => {
        expect(grab(() => q.takeBatch([], 0)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('applyDispositions', () => {
    let base;
    beforeEach(() => {
        base = [];
        base = q.enqueue(base, q.createEvent({ eventType: 'A', uuid: 'a' }, deps));
        base = q.enqueue(base, q.createEvent({ eventType: 'B', uuid: 'b' }, deps));
        base = q.enqueue(base, q.createEvent({ eventType: 'C', uuid: 'c' }, deps));
    });
    test('synced -> SYNCED; retry -> QUEUED retry++; rejected -> REJECTED with reason', () => {
        const out = q.applyDispositions(base, { a: 'synced', b: 'retry', c: 'rejected' }, { c: 'WMS_INVALID_QUANTITY' });
        const by = (u) => out.find((e) => e.uuid === u);
        expect(by('a').status).toBe('SYNCED');
        expect(by('b').status).toBe('QUEUED');
        expect(by('b').retry).toBe(1);
        expect(by('c').status).toBe('REJECTED');
        expect(by('c').rejectReason).toBe('WMS_INVALID_QUANTITY');
    });
    test('unknown disposition throws', () => {
        expect(grab(() => q.applyDispositions(base, { a: 'weird' })).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
    test('does not mutate the input queue', () => {
        const before = JSON.stringify(base);
        q.applyDispositions(base, { a: 'synced' });
        expect(JSON.stringify(base)).toBe(before);
    });
});

describe('purgeSynced', () => {
    test('drops SYNCED, keeps QUEUED/REJECTED', () => {
        let queue = [];
        queue = q.enqueue(queue, q.createEvent({ uuid: 'a' }, deps));
        queue = q.enqueue(queue, q.createEvent({ uuid: 'b' }, deps));
        queue = q.applyDispositions(queue, { a: 'synced' });
        expect(q.purgeSynced(queue)).toHaveLength(1);
    });
});
