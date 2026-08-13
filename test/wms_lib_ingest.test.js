/**
 * Unit tests for wms_lib_ingest (vertical slice). No NetSuite account.
 * The idempotency classification (UNIQUE_RCRD_ID_REQD, not DUP_CSTM_RCRD_ENTRY)
 * is the assumption Day 5 proves in-account; pinned here so the distinction can't
 * regress silently.
 */
const ingest = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_ingest.js');

const VALID = {
    uuid: 'u-1', eventType: 'RECEIPT_PO', sourceDocument: 'PO123',
    item: '42', quantity: 3, bin: '7', location: '1',
};

describe('parseBatch', () => {
    test('accepts { events: [...] } and a bare array', () => {
        expect(ingest.parseBatch({ events: [VALID] })).toEqual([VALID]);
        expect(ingest.parseBatch([VALID])).toEqual([VALID]);
    });
    test('a malformed body throws ERR_WMS_BAD_REQUEST', () => {
        expect(() => ingest.parseBatch(null)).toThrow(/JSON object or array/);
        try {
            ingest.parseBatch({ nope: true });
        } catch (e) {
            expect(e.name).toBe('ERR_WMS_BAD_REQUEST');
        }
    });
});

describe('validateScanEvent', () => {
    test('a complete event passes', () => {
        expect(ingest.validateScanEvent(VALID)).toEqual({ ok: true });
    });
    test('a missing field returns a field-level verdict', () => {
        const e = Object.assign({}, VALID); delete e.bin;
        expect(ingest.validateScanEvent(e)).toEqual({ ok: false, reasonCode: 'WMS_MISSING_FIELD', field: 'bin' });
    });
    test('non-positive quantity is rejected', () => {
        expect(ingest.validateScanEvent(Object.assign({}, VALID, { quantity: 0 }))).toEqual({
            ok: false, reasonCode: 'WMS_INVALID_QUANTITY', field: 'quantity',
        });
    });
});

describe('classifyIngestError', () => {
    test('UNIQUE_RCRD_ID_REQD is idempotent success (PF-13)', () => {
        expect(ingest.classifyIngestError('UNIQUE_RCRD_ID_REQD')).toEqual({ idempotent: true, retryable: false });
    });
    test('DUP_CSTM_RCRD_ENTRY is NOT the idempotency signal (different error)', () => {
        expect(ingest.classifyIngestError('DUP_CSTM_RCRD_ENTRY')).toEqual({ idempotent: false, retryable: false });
    });
    test('transient errors are retryable, others terminal', () => {
        expect(ingest.classifyIngestError('RCRD_HAS_BEEN_CHANGED')).toEqual({ idempotent: false, retryable: true });
        expect(ingest.classifyIngestError('EXCEEDED_MAX_CONCUR_RQST')).toEqual({ idempotent: false, retryable: true });
        expect(ingest.classifyIngestError('SOME_VALIDATION_ERROR')).toEqual({ idempotent: false, retryable: false });
    });
});
