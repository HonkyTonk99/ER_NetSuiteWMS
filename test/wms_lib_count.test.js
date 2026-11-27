/**
 * Unit tests for wms_lib_count (Phase 8 / D-37 - blind count + approval). No account.
 */
const count = require('../src/FileCabinet/SuiteScripts/WMS/lib/wms_lib_count.js');
const grab = (fn) => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

describe('computeVariance - qty and value (D-37)', () => {
    test('over / short / none', () => {
        expect(count.computeVariance(100, 103, 2)).toEqual({ varianceQty: 3, varianceValue: 6, direction: 'OVER' });
        expect(count.computeVariance(100, 95, 2)).toEqual({ varianceQty: -5, varianceValue: -10, direction: 'SHORT' });
        expect(count.computeVariance(100, 100, 2)).toEqual({ varianceQty: 0, varianceValue: 0, direction: 'NONE' });
    });
    test('bad input throws', () => {
        expect(grab(() => count.computeVariance('x', 1, 1)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});

describe('postDecision - no posting without manager approval (D-37)', () => {
    const variance = { varianceQty: -5 };
    test('zero variance -> nothing to post', () => {
        expect(count.postDecision('SUBMITTED', { varianceQty: 0 })).toEqual({ canPost: false, reason: 'NO_VARIANCE' });
    });
    test('variance but not yet approved -> blocked', () => {
        expect(count.postDecision('SUBMITTED', variance)).toEqual({ canPost: false, reason: 'AWAITING_APPROVAL' });
    });
    test('approved variance -> posts', () => {
        expect(count.postDecision('APPROVED', variance)).toEqual({ canPost: true });
    });
    test('unknown state throws', () => {
        expect(grab(() => count.postDecision('WAT', variance)).name).toBe('ERR_WMS_INVALID_ARGUMENT');
    });
});
