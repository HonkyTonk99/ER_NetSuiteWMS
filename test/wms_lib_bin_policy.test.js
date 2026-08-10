/**
 * Unit tests for wms_lib_bin_policy (T-2.3b). No NetSuite account required.
 * Covers every acceptance criterion in the task, plus D-23 error shape and the
 * built-in properties (determinism, no input mutation).
 */
const policyLib = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_bin_policy.js');

const UNIT = { singleSku: true, singleBatch: true };
const BULK_SINGLE_BATCH = { singleSku: true, singleBatch: true };
const BULK_MULTI_BATCH = { singleSku: true, singleBatch: false };
const STAGE = { singleSku: false, singleBatch: false };

describe('wms_lib_bin_policy.check — business verdicts (D-23: returned, not thrown)', () => {
    test('UNIT bin holding ABC rejects putaway of XYZ with a verdict naming ABC (TC-BIN-01)', () => {
        const verdict = policyLib.check(UNIT, { item: 'ABC', lot: 'L1', qty: 5 }, 'XYZ', 'L9');
        expect(verdict).toEqual({
            allowed: false,
            reasonCode: 'WMS_BIN_CONSTRAINT_VIOLATION',
            conflictItem: 'ABC',
            conflictLot: 'L1',
        });
    });

    test('BULK single-batch bin holding BATCH-001 rejects BATCH-002 of the same item (TC-BIN-02)', () => {
        const verdict = policyLib.check(BULK_SINGLE_BATCH, { item: 'ABC', lot: 'BATCH-001', qty: 5 }, 'ABC', 'BATCH-002');
        expect(verdict.allowed).toBe(false);
        expect(verdict.reasonCode).toBe('WMS_BIN_CONSTRAINT_VIOLATION');
    });

    test('STAGE bin (mixed policy) already holding a SKU accepts a fourth SKU (F-18)', () => {
        const verdict = policyLib.check(STAGE, { item: 'SKU3', lot: '', qty: 12 }, 'SKU4', '');
        expect(verdict).toEqual({ allowed: true });
    });

    test('BULK with singleBatch:false accepts a mixed batch — config change, no code change', () => {
        const verdict = policyLib.check(BULK_MULTI_BATCH, { item: 'ABC', lot: 'BATCH-001', qty: 5 }, 'ABC', 'BATCH-002');
        expect(verdict).toEqual({ allowed: true });
    });

    test('empty bin always passes — emptiness is item cleared, never a qty compare (invariant #20)', () => {
        expect(policyLib.check(UNIT, { item: null, lot: null, qty: 0 }, 'ABC', 'L1')).toEqual({ allowed: true });
        expect(policyLib.check(UNIT, { item: '', lot: '', qty: 999 }, 'ABC', 'L1')).toEqual({ allowed: true });
    });

    test('a tiny fractional residue with the item still set is OCCUPIED, so a different SKU is rejected (invariant #20)', () => {
        const verdict = policyLib.check(UNIT, { item: 'ABC', lot: 'L1', qty: 0.0000001 }, 'XYZ', 'L2');
        expect(verdict.allowed).toBe(false);
    });

    test('negative bin with an item set rejects a DIFFERENT SKU as WMS_BIN_NEGATIVE_STATE (occupied, not empty)', () => {
        const verdict = policyLib.check(UNIT, { item: 'ABC', lot: 'L1', qty: -3 }, 'XYZ', 'L2');
        expect(verdict.allowed).toBe(false);
        expect(verdict.reasonCode).toBe('WMS_BIN_NEGATIVE_STATE');
    });

    test('negative bin accepts the SAME SKU and lot so corrective putaway is possible', () => {
        const verdict = policyLib.check(UNIT, { item: 'ABC', lot: 'L1', qty: -3 }, 'ABC', 'L1');
        expect(verdict).toEqual({ allowed: true });
    });

    test('negative bin rejects the same SKU but a DIFFERENT lot (only the recorded SKU+lot, invariant #20)', () => {
        const verdict = policyLib.check(UNIT, { item: 'ABC', lot: 'L1', qty: -3 }, 'ABC', 'L2');
        expect(verdict.allowed).toBe(false);
        expect(verdict.reasonCode).toBe('WMS_BIN_NEGATIVE_STATE');
    });

    test('a blocked bin refuses everything', () => {
        const verdict = policyLib.check(UNIT, { item: 'ABC', lot: 'L1', qty: 5, blocked: true }, 'ABC', 'L1');
        expect(verdict).toEqual({ allowed: false, reasonCode: 'WMS_BIN_BLOCKED' });
    });

    test('stock NetSuite committed elsewhere is still just OCCUPIED — the WMS has no available/committed dimension (Q-10)', () => {
        // The verdict inputs carry only physical state (item/lot/qty); there is no
        // "committed" field to test against, so an occupied bin is occupied.
        const verdict = policyLib.check(UNIT, { item: 'ABC', lot: 'L1', qty: 5 }, 'XYZ', 'L1');
        expect(verdict.allowed).toBe(false);
    });
});

describe('wms_lib_bin_policy.check — programmer errors (D-23: plain Error with ERR_WMS_* name)', () => {
    test('missing policy throws ERR_WMS_INVALID_ARGUMENT', () => {
        expect.assertions(2);
        try {
            policyLib.check(undefined, { item: 'ABC', qty: 1 }, 'ABC', 'L1');
        } catch (e) {
            expect(e).toBeInstanceOf(Error);
            expect(e.name).toBe('ERR_WMS_INVALID_ARGUMENT');
        }
    });

    test('missing currentState and missing proposedItem both throw ERR_WMS_INVALID_ARGUMENT', () => {
        expect(() => policyLib.check(UNIT, null, 'ABC', 'L1')).toThrow(/currentState/);
        expect(() => policyLib.check(UNIT, { item: 'ABC', qty: 1 }, '', 'L1')).toThrow(/proposedItem/);
    });
});

describe('wms_lib_bin_policy — built-in properties', () => {
    test('deterministic: identical inputs yield identical verdicts', () => {
        const args = [UNIT, { item: 'ABC', lot: 'L1', qty: 5 }, 'XYZ', 'L2'];
        expect(policyLib.check(...args)).toEqual(policyLib.check(...args));
    });

    test('mutates none of its arguments', () => {
        const policy = { singleSku: true, singleBatch: true };
        const state = { item: 'ABC', lot: 'L1', qty: 5 };
        const before = JSON.stringify({ policy, state });
        policyLib.check(policy, state, 'XYZ', 'L2');
        expect(JSON.stringify({ policy, state })).toBe(before);
    });
});
