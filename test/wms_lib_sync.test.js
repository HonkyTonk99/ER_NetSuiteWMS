/**
 * Unit tests for wms_lib_sync (Phase 3 / D-56, T-3.5). No account.
 */
const sync = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_sync.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('classifyResponse (200-with-body, D-56)', () => {
    test('accepted/ok/posted/idempotent -> synced', () => {
        ['accepted', 'ok', 'posted', 'idempotent'].forEach((s) => {
            expect(sync.classifyResponse({ uuid: 'x', status: s })).toBe('synced');
        });
    });
    test('busy/retry -> retry', () => {
        expect(sync.classifyResponse({ uuid: 'x', status: 'busy' })).toBe('retry');
        expect(sync.classifyResponse({ uuid: 'x', status: 'retry' })).toBe('retry');
    });
    test('duplicate externalid error is idempotent success (#3)', () => {
        expect(sync.classifyResponse({ uuid: 'x', status: 'rejected', error: 'UNIQUE_RCRD_ID_REQD' })).toBe('synced');
    });
    test('transient platform errors -> retry', () => {
        expect(sync.classifyResponse({ uuid: 'x', status: 'rejected', error: 'EXCEEDED_MAX_CONCUR_RQST' })).toBe('retry');
        expect(sync.classifyResponse({ uuid: 'x', status: 'rejected', error: 'RCRD_HAS_BEEN_CHANGED' })).toBe('retry');
    });
    test('a real validation rejection -> rejected', () => {
        expect(sync.classifyResponse({ uuid: 'x', status: 'rejected', error: 'WMS_INVALID_QUANTITY' })).toBe('rejected');
    });
    test('missing uuid throws', () => {
        expect(grab(() => sync.classifyResponse({ status: 'ok' })).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('dispositionsFor', () => {
    test('builds dispositions + rejection reasons from a batch', () => {
        const { dispositions, reasons } = sync.dispositionsFor([
            { uuid: 'a', status: 'accepted' },
            { uuid: 'b', status: 'busy' },
            { uuid: 'c', status: 'rejected', error: 'WMS_MISSING_FIELD' },
        ]);
        expect(dispositions).toEqual({ a: 'synced', b: 'retry', c: 'rejected' });
        expect(reasons.c).toBe('WMS_MISSING_FIELD');
    });
});

describe('reconcile (reconnect, T-3.5 - server state wins)', () => {
    test('server already has it -> stop resending', () => {
        ['POSTED', 'PROCESSING', 'PENDING', 'DEFERRED', 'SUPERSEDED'].forEach((s) => {
            expect(sync.reconcile(s)).toBe('synced');
        });
    });
    test('FAILED -> rejected', () => {
        expect(sync.reconcile('FAILED')).toBe('rejected');
    });
    test('never seen -> retry (safe to resend)', () => {
        expect(sync.reconcile('')).toBe('retry');
        expect(sync.reconcile('NOT_FOUND')).toBe('retry');
    });
});
