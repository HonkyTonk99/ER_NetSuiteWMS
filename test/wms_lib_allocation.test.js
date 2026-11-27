/**
 * Unit tests for wms_lib_allocation (Phase 6/7 / invariant #15, F-22). No account.
 */
const alloc = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_allocation.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('cap - committed minus already picked, floored at 0', () => {
    test('basic', () => {
        expect(alloc.cap({ committed: 10, picked: 3 })).toBe(7);
        expect(alloc.cap({ committed: 5 })).toBe(5);
        expect(alloc.cap({ committed: 5, picked: 5 })).toBe(0);
        expect(alloc.cap({ committed: 5, picked: 9 })).toBe(0);
    });
});

describe('eligibility (#15) - only lines NetSuite committed stock for', () => {
    test('uncommitted / fully picked lines are not wave-eligible', () => {
        expect(alloc.isEligible({ committed: 0 })).toBe(false);
        expect(alloc.isEligible({ committed: 5, picked: 5 })).toBe(false);
        expect(alloc.isEligible({ committed: 5, picked: 1 })).toBe(true);
    });
    test('eligibleLines filters', () => {
        const lines = [{ id: 1, committed: 0 }, { id: 2, committed: 4 }, { id: 3, committed: 2, picked: 2 }];
        expect(alloc.eligibleLines(lines).map((l) => l.id)).toEqual([2]);
    });
});

describe('validatePick - never exceed commitment (#15)', () => {
    test('within cap ok', () => {
        expect(alloc.validatePick({ committed: 10, picked: 2 }, 5)).toEqual({ ok: true });
    });
    test('over cap is COMMITMENT_EXCEEDED (would ship another order stock)', () => {
        expect(alloc.validatePick({ committed: 10, picked: 8 }, 5)).toEqual({ ok: false, reasonCode: 'COMMITMENT_EXCEEDED', cap: 2 });
    });
    test('non-positive pick throws', () => {
        expect(grab(() => alloc.validatePick({ committed: 10 }, 0)).name).toBe('ERR_WMS_INVALID_QUANTITY');
    });
});
