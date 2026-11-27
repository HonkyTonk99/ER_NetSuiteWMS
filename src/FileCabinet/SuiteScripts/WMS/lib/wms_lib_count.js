/**
 * wms_lib_count - blind cycle count + variance approval (Phase 8; D-37). PURE, and
 * DISTINCT from reconciliation (T-8.3): a counter enters what is physically there
 * without seeing the expected figure; the system computes the variance (qty AND
 * value); a manager must approve before any Inventory Adjustment posts.
 *
 * Lifecycle: LAUNCHED -> COUNTING -> SUBMITTED -> APPROVED -> POSTED (or REJECTED).
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], function () {
    'use strict';

    function err(name, message) {
        var e = new Error(message);
        e.name = name;
        return e;
    }

    function num(v, label) {
        var n = Number(v);
        if (!isFinite(n)) { throw err('ERR_WMS_INVALID_ARGUMENT', label + ' must be a finite number'); }
        return n;
    }

    /**
     * Variance for one counted line. unitCost drives variance-by-value (D-37).
     * Returns { varianceQty, varianceValue, direction:'OVER'|'SHORT'|'NONE' }.
     */
    function computeVariance(expected, counted, unitCost) {
        var e = num(expected, 'expected');
        var c = num(counted, 'counted');
        var cost = unitCost == null ? 0 : num(unitCost, 'unitCost');
        var vq = c - e;
        return {
            varianceQty: vq,
            varianceValue: vq * cost,
            direction: vq > 0 ? 'OVER' : (vq < 0 ? 'SHORT' : 'NONE'),
        };
    }

    /** A non-zero variance must be approved before it can post (D-37). */
    function requiresApproval(variance) {
        return !!variance && Number(variance.varianceQty) !== 0;
    }

    var VALID_STATES = { LAUNCHED: 1, COUNTING: 1, SUBMITTED: 1, APPROVED: 1, POSTED: 1, REJECTED: 1 };

    /**
     * Can the adjustment for this count post? Only an APPROVED count with a non-zero
     * variance posts; a zero variance needs nothing; any other state is blocked.
     */
    function postDecision(state, variance) {
        var s = String(state || '').toUpperCase();
        if (!VALID_STATES[s]) {
            throw err('ERR_WMS_INVALID_ARGUMENT', 'unknown count state: ' + state);
        }
        if (!requiresApproval(variance)) {
            return { canPost: false, reason: 'NO_VARIANCE' };
        }
        if (s !== 'APPROVED') {
            return { canPost: false, reason: 'AWAITING_APPROVAL' };
        }
        return { canPost: true };
    }

    return {
        computeVariance: computeVariance,
        requiresApproval: requiresApproval,
        postDecision: postDecision,
    };
});
